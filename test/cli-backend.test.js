import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCliBackend,
  flattenMessages,
  geminiEventToAnthropic,
  codexEventToAnthropic,
} from '../src/cli-backend.js';

test('isCliBackend recognizes codex and gemini', () => {
  assert.equal(isCliBackend('codex'), true);
  assert.equal(isCliBackend('gemini'), true);
  assert.equal(isCliBackend('oauth'), false);
  assert.equal(isCliBackend('apikey'), false);
  assert.equal(isCliBackend(undefined), false);
});

test('flattenMessages renders system + user + assistant in order', () => {
  const out = flattenMessages({
    system: 'You are helpful.',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'what is 2+2?' },
    ],
  });
  assert.match(out, /<system>\nYou are helpful\.\n<\/system>/);
  assert.match(out, /<user>\nhi\n<\/user>/);
  assert.match(out, /<assistant>\nhello\n<\/assistant>/);
  assert.match(out, /<user>\nwhat is 2\+2\?\n<\/user>/);
  // Closes with an open <assistant> tag inviting the model's continuation
  assert.ok(out.endsWith('<assistant>'));
});

test('flattenMessages handles array-shape system + content blocks', () => {
  const out = flattenMessages({
    system: [{ type: 'text', text: 'sysblock' }],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'see attachment' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    }],
  });
  assert.match(out, /sysblock/);
  assert.match(out, /\[image #1\]/);
});

test('flattenMessages renders tool_use and tool_result blocks', () => {
  const out = flattenMessages({
    messages: [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me check' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: '/foo' } },
      ],
    }, {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents' },
      ],
    }],
  });
  assert.match(out, /<tool_use name="read_file">/);
  assert.match(out, /<tool_result for="tu1">/);
  assert.match(out, /file contents/);
});

test('geminiEventToAnthropic emits message_start on init', () => {
  const state = {};
  const out = geminiEventToAnthropic(
    { type: 'init', model: 'gemini-2.5' }, state, 'msg_test', 'claude-opus-4-7',
  );
  assert.equal(out.length, 1);
  assert.match(out[0], /event: message_start/);
  assert.match(out[0], /"id":"msg_test"/);
  assert.match(out[0], /"model":"gemini-2.5"/);
  assert.equal(state.messageStarted, true);
});

test('geminiEventToAnthropic emits content_block_start once + deltas', () => {
  const state = { messageStarted: true };
  const a = geminiEventToAnthropic(
    { type: 'message', role: 'assistant', content: 'hello', delta: true },
    state, 'msg_x', 'm',
  );
  // Two SSE chunks on first delta: content_block_start + content_block_delta
  assert.equal(a.length, 2);
  assert.match(a[0], /event: content_block_start/);
  assert.match(a[1], /event: content_block_delta/);
  assert.match(a[1], /"text":"hello"/);

  const b = geminiEventToAnthropic(
    { type: 'message', role: 'assistant', content: ' world', delta: true },
    state, 'msg_x', 'm',
  );
  // Subsequent deltas only emit content_block_delta
  assert.equal(b.length, 1);
  assert.match(b[0], /event: content_block_delta/);
  assert.match(b[0], /"text":" world"/);
});

test('geminiEventToAnthropic on result closes the block + emits usage', () => {
  const state = { messageStarted: true, blockOpen: true };
  const out = geminiEventToAnthropic(
    { type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 12 } },
    state, 'msg_x', 'm',
  );
  // content_block_stop, message_delta (with usage), message_stop
  assert.equal(out.length, 3);
  assert.match(out[0], /event: content_block_stop/);
  assert.match(out[1], /event: message_delta/);
  assert.match(out[1], /"input_tokens":100/);
  assert.match(out[1], /"output_tokens":12/);
  assert.match(out[1], /"stop_reason":"end_turn"/);
  assert.match(out[2], /event: message_stop/);
  assert.equal(state.done, true);
});

test('geminiEventToAnthropic on failed result sets stop_reason=error', () => {
  const state = { messageStarted: true, blockOpen: true };
  const out = geminiEventToAnthropic(
    { type: 'result', status: 'failed' }, state, 'msg', 'm',
  );
  const delta = out.find(s => s.includes('event: message_delta'));
  assert.ok(delta);
  assert.match(delta, /"stop_reason":"error"/);
});

test('codexEventToAnthropic surfaces agent_message text', () => {
  const state = {};
  const out = codexEventToAnthropic(
    { type: 'agent_message', message: 'codex says hi' },
    state, 'msg_codex', 'codex-default',
  );
  // message_start + content_block_start + content_block_delta
  assert.equal(out.length, 3);
  assert.match(out[0], /event: message_start/);
  assert.match(out[1], /event: content_block_start/);
  assert.match(out[2], /"text":"codex says hi"/);
});

test('codexEventToAnthropic handles nested msg.* shape', () => {
  const state = { messageStarted: true };
  const out = codexEventToAnthropic(
    { msg: { type: 'agent_message', message: 'nested' } },
    state, 'msg_x', 'm',
  );
  // content_block_start + content_block_delta
  assert.equal(out.length, 2);
  assert.match(out[1], /"text":"nested"/);
});

test('codexEventToAnthropic closes on task_complete', () => {
  const state = { messageStarted: true, blockOpen: true };
  const out = codexEventToAnthropic({ type: 'task_complete' }, state, 'm', 'm');
  // content_block_stop + message_delta + message_stop
  assert.equal(out.length, 3);
  assert.match(out[0], /event: content_block_stop/);
  assert.match(out[1], /event: message_delta/);
  assert.match(out[2], /event: message_stop/);
  assert.equal(state.done, true);
});

test('codexEventToAnthropic handles item.completed.agent_message.text shape', () => {
  // Real codex --json event shape (verified against codex-cli 0.128.0):
  //   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hi"}}
  const state = {};
  const out = codexEventToAnthropic(
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'real-shape' } },
    state, 'msg_x', 'm',
  );
  assert.equal(out.length, 3); // message_start + content_block_start + content_block_delta
  assert.match(out[2], /"text":"real-shape"/);
});

test('codexEventToAnthropic extracts usage from turn.completed', () => {
  // Real shape:
  //   {"type":"turn.completed","usage":{"input_tokens":21366,"cached_input_tokens":3456,
  //    "output_tokens":64,"reasoning_output_tokens":57}}
  const state = { messageStarted: true, blockOpen: true };
  const out = codexEventToAnthropic(
    {
      type: 'turn.completed',
      usage: { input_tokens: 21366, cached_input_tokens: 3456, output_tokens: 64, reasoning_output_tokens: 57 },
    },
    state, 'msg_x', 'm',
  );
  const delta = out.find(s => s.includes('event: message_delta'));
  assert.ok(delta);
  assert.match(delta, /"input_tokens":21366/);
  // output (64) + reasoning_output (57) = 121
  assert.match(delta, /"output_tokens":121/);
  assert.equal(state.inputTokens, 21366);
  assert.equal(state.outputTokens, 121);
});
