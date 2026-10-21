// The colours the overlay and the control page use must keep meeting WCAG AA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('npm run contrast: every text colour pair meets WCAG AA on dark and light', () => {
  const r = spawnSync(process.execPath, ['scripts/contrast.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /All pairs pass AA/);
});
