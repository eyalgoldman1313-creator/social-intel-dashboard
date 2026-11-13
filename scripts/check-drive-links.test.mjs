import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDriveLinks, distFromArgv } from './check-drive-links.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/check-drive-links.mjs');

test('distFromArgv skips flags and keeps the first positional path', () => {
  assert.equal(distFromArgv(['--check'], '/workspace'), undefined);
  assert.equal(distFromArgv(['--check', '--verbose'], '/workspace'), undefined);
  assert.equal(distFromArgv(['--check', 'out'], '/workspace'), join('/workspace', 'out'));
  assert.equal(distFromArgv(['dist', '--check'], '/workspace'), join('/workspace', 'dist'));
});

test('a missing dist sets missingDist and exit code 2', () => {
  const prev = process.exitCode;
  const missing = join(tmpdir(), `no-dist-${process.pid}-${Date.now()}`);
  try {
    const r = checkDriveLinks(missing);
    assert.equal(r.missingDist, true);
    assert.equal(r.total, 0);
    assert.deepEqual(r.outdated, []);
    assert.equal(process.exitCode, 2);
  } finally {
    process.exitCode = prev;
  }
});

test('CLI --check reads the positional dist and does not report 0 files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  try {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested/index.html'), '<a href="https://drive.google.com/file/d/abcdefghijklmnopqrstuv/view">x</a>');
    const out = spawnSync(process.execPath, [script, '--check', dir], { encoding: 'utf8', cwd: root });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /drive links: 1 files/);
    assert.doesNotMatch(out.stdout, /0 files/);
    assert.doesNotMatch(`${out.stdout}\n${out.stderr}`, /--check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 2 when the dist directory does not exist', () => {
  const missing = join(tmpdir(), `missing-dist-${process.pid}`);
  const out = spawnSync(process.execPath, [script, '--check', missing], { encoding: 'utf8', cwd: root });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /dist not found/);
  assert.doesNotMatch(out.stdout, /0 files/);
  assert.doesNotMatch(out.stderr, /--check/);
});

test('CLI --check alone does not look for a directory named --check', () => {
  const out = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', cwd: tmpdir() });
  assert.doesNotMatch(`${out.stdout}\n${out.stderr}`, /\/--check|\\--check/);
  if (existsSync(join(root, 'dist'))) {
    assert.equal(out.status, 0);
    assert.match(out.stdout, /drive links: [1-9]\d* files/);
  } else {
    assert.equal(out.status, 2);
    assert.match(out.stderr, new RegExp(`dist not found: ${root}/dist`));
    assert.doesNotMatch(out.stdout, /0 files/);
  }
});
