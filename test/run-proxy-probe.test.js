// Pre-flight proxy reachability check.
//
// runCommand probes /teamclaude/status before spawning claude. If the proxy
// server is not running, the user previously got Claude Code's opaque
// "Unable to connect to API (ConnectionRefused)" with no signal that
// `teamclaude server` had not been started. These tests pin the new
// actionable error path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'src/index.js');
const fixturesDir = path.join(repoRoot, 'test/fixtures');

// Find a port that is currently closed by binding briefly then releasing.
function pickClosedPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(err => err ? reject(err) : resolve(port));
    });
  });
}

test('PROBE-01: proxy unreachable → actionable stderr mentions port + `teamclaude server`', async () => {
  const closedPort = await pickClosedPort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamclaude-probe-'));
  const cfgPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    proxy: { port: closedPort, apiKey: 'test-key' },
    upstream: 'https://api.anthropic.com',
    switchThreshold: 0.98,
    accounts: [],
  }));

  try {
    const result = spawnSync('node', [indexPath, 'run', 'hello'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: fixturesDir + path.delimiter + process.env.PATH,
        TEAMCLAUDE_CONFIG: cfgPath,
      },
    });
    assert.notStrictEqual(result.status, 0,
      `expected non-zero exit on unreachable proxy; got ${result.status}`);
    assert.match(result.stderr, new RegExp(`localhost:${closedPort}`),
      `stderr missing port: ${result.stderr}`);
    assert.match(result.stderr, /teamclaude server/,
      `stderr missing start hint: ${result.stderr}`);
    // claude binary must NOT have been invoked — fake-claude prints ARG: lines
    // on stdout. Pre-flight should short-circuit before spawn.
    assert.doesNotMatch(result.stdout, /^ARG:/m,
      `claude was invoked despite unreachable proxy: ${result.stdout}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
