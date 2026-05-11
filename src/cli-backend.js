import { spawn, spawnSync } from 'node:child_process';
import { writeFile, unlink, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * CLI backend adapter: speak Anthropic Messages API on the front,
 * spawn `codex exec` or `gemini -p` on the back. Each backend runs
 * its own agent loop; we translate the structured CLI events into
 * Anthropic SSE events (or buffer them into a single Message JSON).
 *
 * See .planning/quick/20260511-codex-gemini-backends/PLAN.md for the
 * design contract and the caveats around tool-call passthrough.
 */

const SUPPORTED = new Set(['codex', 'gemini']);

export function isCliBackend(type) {
  return SUPPORTED.has(type);
}

/**
 * Verify the CLI binary is installed. Returns { ok, version, error }.
 * Never throws. Used by `teamclaude login --codex/--gemini` for the
 * pre-flight check and by the server startup banner.
 */
export function probeCliInstalled(type) {
  if (!SUPPORTED.has(type)) return { ok: false, error: `Unknown backend: ${type}` };
  const r = spawnSync(type, ['--version'], { encoding: 'utf-8' });
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      return { ok: false, error: `\`${type}\` binary not found in PATH` };
    }
    return { ok: false, error: `\`${type} --version\` failed: ${r.error.message}` };
  }
  if (r.status !== 0) {
    return { ok: false, error: `\`${type} --version\` exited ${r.status}` };
  }
  return { ok: true, version: (r.stdout || '').trim().split('\n')[0] || 'unknown' };
}

/**
 * Flatten an Anthropic Messages request body into a single prompt
 * string suitable for piping into a CLI agent.
 *
 * Rules:
 *  - `system` (string or content blocks) → leading `<system>...</system>`
 *  - `messages[]` rendered as `<user>` / `<assistant>` blocks
 *  - Content blocks: `text` → text; `tool_use` / `tool_result` → tagged;
 *    `image` → "[image #N]" placeholder (the actual files are materialized
 *    separately by `extractImages` for backends that accept them).
 *
 * Exported so tests can pin the format without spawning subprocesses.
 */
export function flattenMessages(body) {
  const parts = [];
  const sys = body.system;
  if (sys) {
    const sysText = renderContent(sys);
    if (sysText) parts.push(`<system>\n${sysText}\n</system>`);
  }
  let imageCounter = 0;
  for (const m of body.messages || []) {
    const tag = m.role === 'assistant' ? 'assistant' : 'user';
    const text = renderContent(m.content, { onImage: () => `[image #${++imageCounter}]` });
    if (!text) continue;
    parts.push(`<${tag}>\n${text}\n</${tag}>`);
  }
  parts.push('<assistant>');
  return parts.join('\n\n');
}

function renderContent(content, opts = {}) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content);
  const lines = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text') lines.push(block.text || '');
    else if (block.type === 'image') lines.push(opts.onImage ? opts.onImage(block) : '[image]');
    else if (block.type === 'tool_use') {
      lines.push(`<tool_use name="${block.name}">\n${JSON.stringify(block.input || {}, null, 2)}\n</tool_use>`);
    } else if (block.type === 'tool_result') {
      const inner = typeof block.content === 'string'
        ? block.content
        : renderContent(block.content);
      lines.push(`<tool_result for="${block.tool_use_id || ''}">\n${inner}\n</tool_result>`);
    }
  }
  return lines.join('\n');
}

/**
 * Pull image blocks out of the messages payload and materialize them
 * to temp files. Returns { paths, cleanup }. Only used for backends
 * with documented image-input support (codex `-i FILE`).
 */
async function extractImages(body) {
  const images = [];
  for (const m of body.messages || []) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block?.type !== 'image') continue;
      const src = block.source;
      if (!src || src.type !== 'base64' || !src.data) continue;
      images.push(src);
    }
  }
  if (images.length === 0) return { paths: [], cleanup: async () => {} };

  const dir = await mkdtemp(join(tmpdir(), 'teamclaude-img-'));
  const paths = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const mime = img.media_type || 'image/png';
    const ext = mime.split('/')[1] || 'png';
    const path = join(dir, `img-${i}.${ext}`);
    await writeFile(path, Buffer.from(img.data, 'base64'));
    paths.push(path);
  }
  const cleanup = async () => {
    for (const p of paths) { try { await unlink(p); } catch {} }
  };
  return { paths, cleanup };
}

/**
 * Build the spawn args for a backend.
 *   codex:  codex exec --json --skip-git-repo-check --ephemeral \
 *             [--dangerously-bypass-approvals-and-sandbox] \
 *             [-i IMG]... -o LAST_MSG_FILE -
 *   gemini: gemini -p PROMPT --output-format stream-json -y
 *
 * The prompt is passed on stdin for codex (handles long prompts safely)
 * and via -p for gemini (its CLI rejects empty stdin combined with -p).
 */
function buildSpawnArgs(type, prompt, imagePaths, lastMsgFile) {
  if (type === 'codex') {
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--dangerously-bypass-approvals-and-sandbox',
    ];
    for (const p of imagePaths) args.push('-i', p);
    if (lastMsgFile) args.push('-o', lastMsgFile);
    args.push('-'); // read prompt from stdin
    return { cmd: 'codex', args, stdinPrompt: prompt };
  }
  if (type === 'gemini') {
    // -y (yolo) auto-approves so the agent never blocks on stdin
    return {
      cmd: 'gemini',
      args: ['-p', prompt, '--output-format', 'stream-json', '-y'],
      stdinPrompt: null,
    };
  }
  throw new Error(`Unknown backend type: ${type}`);
}

/**
 * Translate one gemini stream-json event into zero or more Anthropic
 * SSE events. Stateful: `state` carries { messageStarted, blockOpen,
 * inputTokens, outputTokens }. Exported for unit testing.
 */
export function geminiEventToAnthropic(event, state, messageId, model) {
  const out = [];
  if (!event || typeof event !== 'object') return out;

  if (event.type === 'init' && !state.messageStarted) {
    state.messageStarted = true;
    out.push(sse('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: event.model || model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
    return out;
  }

  if (event.type === 'message' && event.role === 'assistant' && event.delta) {
    if (!state.blockOpen) {
      state.blockOpen = true;
      out.push(sse('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }));
    }
    const text = event.content || '';
    if (text) {
      out.push(sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      }));
    }
    return out;
  }

  if (event.type === 'result') {
    if (state.blockOpen) {
      state.blockOpen = false;
      out.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
    }
    const stats = event.stats || {};
    const inputTokens = num(stats.input_tokens) || num(stats.input) || 0;
    const outputTokens = num(stats.output_tokens) || 0;
    state.inputTokens = inputTokens;
    state.outputTokens = outputTokens;
    const stopReason = event.status === 'success' ? 'end_turn' : 'error';
    out.push(sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }));
    out.push(sse('message_stop', { type: 'message_stop' }));
    state.done = true;
  }

  return out;
}

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function sse(eventName, data) {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Main entry. Spawns the CLI, translates its output to Anthropic
 * Messages (JSON when stream=false, SSE when stream=true), and writes
 * directly to `res`. Updates the AccountManager's request counter.
 */
export async function runCliBackend(account, body, res, accountManager, hooks, reqId) {
  let payload;
  try {
    payload = JSON.parse(body.toString());
  } catch (err) {
    return respondError(res, 400, 'invalid_request_error', `Invalid JSON body: ${err.message}`);
  }

  const isStream = !!payload.stream;
  const model = payload.model || `${account.type}-default`;
  const messageId = `msg_${randomBytes(12).toString('hex')}`;

  const { paths: imagePaths, cleanup: cleanupImages } =
    account.type === 'codex' ? await extractImages(payload) : { paths: [], cleanup: async () => {} };

  // codex `-o FILE` captures the agent's final message text — useful as a
  // fallback when the JSONL stream doesn't surface a clean assistant string.
  let lastMsgFile = null;
  if (account.type === 'codex') {
    lastMsgFile = join(tmpdir(), `teamclaude-codex-${randomBytes(8).toString('hex')}.txt`);
  }

  const prompt = flattenMessages(payload);
  const { cmd, args, stdinPrompt } = buildSpawnArgs(account.type, prompt, imagePaths, lastMsgFile);

  hooks?.onRequestRouted?.(reqId, { account: account.name });

  let child;
  try {
    child = spawn(cmd, args, { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    await cleanupImages();
    return respondError(res, 502, 'proxy_error', `Failed to spawn ${cmd}: ${err.message}`);
  }

  // Pre-emptive ENOENT trap: spawn() rejects asynchronously
  let spawnFailed = false;
  child.on('error', (err) => {
    spawnFailed = true;
    if (!res.headersSent) {
      respondError(res, 502, 'proxy_error', `Backend \`${cmd}\` not available: ${err.message}`);
    }
  });

  if (stdinPrompt != null) {
    child.stdin.write(stdinPrompt);
  }
  child.stdin.end();

  // Track this request on the account
  if (accountManager?.updateUsage) {
    // CLI backends have no token headers; bump request count via a 0-token call
    const acct = accountManager.accounts[account.index];
    if (acct) {
      acct.usage.totalRequests++;
      acct.usage.lastUsed = new Date().toISOString();
    }
  }

  // stderr → console (best effort), don't crash on partial reads
  let stderrBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  if (isStream) {
    return runStreamingPipeline(child, account, model, messageId, res, lastMsgFile, cleanupImages, () => stderrBuf, accountManager);
  } else {
    return runBufferedPipeline(child, account, model, messageId, res, lastMsgFile, cleanupImages, () => stderrBuf, accountManager);
  }
}

/**
 * Streaming path: parse stdout JSONL line-by-line, emit Anthropic SSE
 * events to the client as they happen.
 */
async function runStreamingPipeline(child, account, model, messageId, res, lastMsgFile, cleanupImages, getStderr, accountManager) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });

  const state = { messageStarted: false, blockOpen: false, done: false, sawAnyText: false };
  let buf = '';

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleLine(trimmed, account.type, state, messageId, model, res);
      if (state.blockOpen) state.sawAnyText = true;
    }
  });

  await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('exit', resolve);
  });

  // Drain any trailing partial line
  if (buf.trim()) {
    handleLine(buf.trim(), account.type, state, messageId, model, res);
  }

  // Fallback: codex JSONL might not always emit a clean text stream
  if (!state.done) {
    let fallbackText = '';
    if (lastMsgFile) {
      try { fallbackText = (await readFile(lastMsgFile, 'utf-8')).trim(); } catch {}
    }
    if (!state.messageStarted) {
      res.write(sse('message_start', {
        type: 'message_start',
        message: {
          id: messageId, type: 'message', role: 'assistant',
          content: [], model,
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
      state.messageStarted = true;
    }
    if (fallbackText) {
      if (!state.blockOpen) {
        res.write(sse('content_block_start', {
          type: 'content_block_start', index: 0,
          content_block: { type: 'text', text: '' },
        }));
        state.blockOpen = true;
      }
      res.write(sse('content_block_delta', {
        type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: fallbackText },
      }));
    }
    if (state.blockOpen) {
      res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
    }
    const exitOk = child.exitCode === 0;
    res.write(sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: exitOk ? 'end_turn' : 'error', stop_sequence: null },
      usage: { input_tokens: 0, output_tokens: 0 },
    }));
    res.write(sse('message_stop', { type: 'message_stop' }));
  }

  res.end();

  // Account-wide token tally — same updateUsage path Anthropic accounts use,
  // so `teamclaude accounts` shows a consistent "Total: N tokens" line.
  if (accountManager?.updateUsage && (state.inputTokens || state.outputTokens)) {
    accountManager.updateUsage(account.index, state.inputTokens || 0, state.outputTokens || 0);
  }

  await cleanupImages();
  if (lastMsgFile) { try { await unlink(lastMsgFile); } catch {} }

  if (child.exitCode !== 0) {
    console.error(`[TeamClaude] ${account.type} exited with code ${child.exitCode}: ${getStderr().slice(0, 800)}`);
    const acct = accountManager?.accounts?.[account.index];
    if (acct) acct.status = 'error';
  }
}

/**
 * Buffered path: collect all assistant text from CLI output, return a
 * single Anthropic Messages JSON response.
 */
async function runBufferedPipeline(child, account, model, messageId, res, lastMsgFile, cleanupImages, getStderr, accountManager) {
  const state = { messageStarted: false, blockOpen: false, done: false };
  let textParts = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  let buf = '';

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const evt = collectEventForBuffer(trimmed, account.type);
      if (evt?.text) textParts.push(evt.text);
      if (evt?.usage) usage = evt.usage;
      if (evt?.done) state.done = true;
    }
  });

  await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('exit', resolve);
  });

  if (buf.trim()) {
    const evt = collectEventForBuffer(buf.trim(), account.type);
    if (evt?.text) textParts.push(evt.text);
    if (evt?.usage) usage = evt.usage;
  }

  let finalText = textParts.join('');
  if (!finalText && lastMsgFile) {
    try { finalText = (await readFile(lastMsgFile, 'utf-8')).trim(); } catch {}
  }

  await cleanupImages();
  if (lastMsgFile) { try { await unlink(lastMsgFile); } catch {} }

  const exitOk = child.exitCode === 0;
  if (!exitOk && !finalText) {
    const err = getStderr().slice(0, 800) || `\`${account.type}\` exited ${child.exitCode}`;
    const acct = accountManager?.accounts?.[account.index];
    if (acct) acct.status = 'error';
    return respondError(res, 502, 'proxy_error', `${account.type} backend failed: ${err}`);
  }

  if (accountManager?.updateUsage && (usage.input_tokens || usage.output_tokens)) {
    accountManager.updateUsage(account.index, usage.input_tokens, usage.output_tokens);
  }

  const response = {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: finalText }],
    model,
    stop_reason: exitOk ? 'end_turn' : 'error',
    stop_sequence: null,
    usage,
  };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(response));
}

/**
 * Parse one JSONL line and dispatch SSE writes to the client.
 */
function handleLine(line, type, state, messageId, model, res) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const sseChunks = type === 'gemini'
    ? geminiEventToAnthropic(event, state, messageId, model)
    : codexEventToAnthropic(event, state, messageId, model);
  for (const chunk of sseChunks) res.write(chunk);
}

/**
 * Buffered helper: same parsing as `handleLine` but accumulates
 * text + usage instead of writing SSE.
 */
function collectEventForBuffer(line, type) {
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  if (type === 'gemini') {
    if (event.type === 'message' && event.role === 'assistant' && event.delta) {
      return { text: event.content || '' };
    }
    if (event.type === 'result') {
      const stats = event.stats || {};
      return {
        done: true,
        usage: {
          input_tokens: num(stats.input_tokens) || num(stats.input) || 0,
          output_tokens: num(stats.output_tokens) || 0,
        },
      };
    }
    return null;
  }
  // codex
  if (event.type === 'agent_message' || event.type === 'item.completed' || event.type === 'message') {
    const text = extractCodexText(event);
    if (text) return { text };
  }
  if (event.type === 'task_complete' || event.type === 'turn.completed' || event.type === 'completion') {
    const usage = extractCodexUsage(event);
    return { done: true, usage: usage || undefined };
  }
  return null;
}

/**
 * Codex JSONL events vary by release. Defensively pull text from the
 * shapes seen in practice: {msg: {type:"agent_message", message:"..."}},
 * {type:"agent_message", message:"..."}, {item:{content:[{text:"..."}]}}.
 */
export function codexEventToAnthropic(event, state, messageId, model) {
  const out = [];
  if (!state.messageStarted) {
    state.messageStarted = true;
    out.push(sse('message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant',
        content: [], model,
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
  }
  const text = extractCodexText(event);
  if (text) {
    if (!state.blockOpen) {
      state.blockOpen = true;
      out.push(sse('content_block_start', {
        type: 'content_block_start', index: 0,
        content_block: { type: 'text', text: '' },
      }));
    }
    out.push(sse('content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text },
    }));
  }
  if (isCodexDone(event)) {
    if (state.blockOpen) {
      state.blockOpen = false;
      out.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
    }
    const usage = extractCodexUsage(event) || { input_tokens: 0, output_tokens: 0 };
    state.inputTokens = usage.input_tokens;
    state.outputTokens = usage.output_tokens;
    out.push(sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage,
    }));
    out.push(sse('message_stop', { type: 'message_stop' }));
    state.done = true;
  }
  return out;
}

function extractCodexText(event) {
  if (!event || typeof event !== 'object') return '';
  // Common shapes observed across codex CLI releases:
  //   {"type":"agent_message","message":"..."}                     (older)
  //   {"msg":{"type":"agent_message","message":"..."}}             (wrapper)
  //   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
  //   {"type":"message","content":"..."}                           (generic)
  if (event.type === 'agent_message' && typeof event.message === 'string') return event.message;
  if (event.msg?.type === 'agent_message' && typeof event.msg.message === 'string') return event.msg.message;
  if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') return event.item.text;
  if (event.type === 'message' && typeof event.content === 'string') return event.content;
  if (event.item?.content && Array.isArray(event.item.content)) {
    return event.item.content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  if (event.delta && typeof event.delta === 'string') return event.delta;
  return '';
}

/**
 * Pull token usage from a codex event. Real shape:
 *   {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N,
 *    "cached_input_tokens":N,"reasoning_output_tokens":N}}
 * Returns {input_tokens, output_tokens} or null. Reasoning tokens roll into
 * output_tokens — they bill identically and Anthropic clients don't model them.
 */
function extractCodexUsage(event) {
  const u = event?.usage || event?.msg?.usage;
  if (!u || typeof u !== 'object') return null;
  const input = num(u.input_tokens) || num(u.input) || 0;
  const output = (num(u.output_tokens) || 0) + (num(u.reasoning_output_tokens) || 0);
  if (!input && !output) return null;
  return { input_tokens: input, output_tokens: output };
}

function isCodexDone(event) {
  if (!event) return false;
  return event.type === 'task_complete'
    || event.type === 'turn.completed'
    || event.type === 'completion'
    || event.msg?.type === 'task_complete';
}

function respondError(res, status, errType, message) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    type: 'error',
    error: { type: errType, message },
  }));
}
