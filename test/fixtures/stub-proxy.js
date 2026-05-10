#!/usr/bin/env node
// Minimal /teamclaude/status responder used by passthrough tests.
// The runCommand pre-flight probes this endpoint before spawning claude.
// Runs as its own process so the test harness can keep using spawnSync.
import http from 'node:http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{}');
});

server.listen(0, () => {
  process.stdout.write(`PORT=${server.address().port}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
