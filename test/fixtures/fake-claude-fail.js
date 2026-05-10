#!/usr/bin/env node
// Fake claude that always crashes. Used by HELP-04 / ERR tests to simulate a
// non-ENOENT spawn-failure path (the binary EXISTS and runs, but exits non-zero).
//
// Exits with code 7 and prints `simulated claude crash` on stderr regardless
// of argv. Tests that want exit-code propagation should use this fixture in
// place of fake-claude.js.

process.stderr.write('simulated claude crash\n');
process.exit(7);
