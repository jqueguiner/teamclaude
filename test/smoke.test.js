// Smoke test: confirms `npm test` is wired and node:test runs.
// Not tied to any requirement — purely a scaffold check.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('npm test runs', () => {
  assert.ok(true);
});
