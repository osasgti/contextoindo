// Closeness curve, competition ranks and the vector ranking, on a 12-word fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { closeness } from '../src/game/closeness.js';
import { competitionRanks } from '../src/game/ranker.js';
import { loadVectors } from '../src/game/vectors.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/vectors.vec', import.meta.url));

test('closeness: rank 1 is full, rank N is empty, and it only falls as the rank grows', () => {
  assert.equal(closeness(1, 100000), 1);
  assert.equal(closeness(100000, 100000), 0);
  let last = 1;
  for (let r = 2; r <= 100000; r += 997) {
    const c = closeness(r, 100000);
    assert.ok(c <= last, `rank ${r} must not be closer than rank ${r - 997}`);
    last = c;
  }
});

test('closeness: the top of the board stays readable (rank 100 of 100000 is 0.6)', () => {
  // rank 100 sits exactly on 0.6, so compare with a tolerance for float rounding
  assert.ok(closeness(100, 100000) >= 0.6 - 1e-9);
  assert.ok(closeness(99, 100000) > 0.6);
  assert.ok(closeness(1000, 100000) >= 0.4 - 1e-9);
});

test('closeness: out of range (no rank) is empty, and tiny vocabularies do not blow up', () => {
  assert.equal(closeness(null, 1000), 0);
  assert.equal(closeness(undefined, 1000), 0);
  assert.equal(closeness(1, 1), 1);
  assert.ok(Number.isFinite(closeness(2, 1)));
});

test('competitionRanks: equal similarities share a rank, the next place skips them', () => {
  // word 0 is the secret itself, so it is rank 1 whatever its similarity says
  const sims = Float32Array.from([0.1, 0.5, 0.9, 0.5, 0.2]);
  assert.deepEqual([...competitionRanks(sims, 0)], [1, 3, 2, 3, 5]);
});

test('competitionRanks: the secret is rank 1 even with a duplicate vector', () => {
  const sims = Float32Array.from([1, 1, 0.3]);
  assert.deepEqual([...competitionRanks(sims, 0)], [1, 2, 3]);
});

test('loadVectors reads the fixture and ranks against the secret', async () => {
  const space = await loadVectors(FIXTURE);
  assert.equal(space.size, 12);
  assert.equal(space.dim, 3);
  const r = space.ranker('tangga');
  assert.equal(r.rankOf('tangga'), 1);
  assert.equal(r.rankOf('rumah'), 2);
  assert.equal(r.rankOf('atap'), 3);
  assert.equal(r.rankOf('gedung'), 4);
  assert.equal(r.rankOf('kota'), 7);
  assert.equal(r.rankOf('buku'), 8);
  assert.equal(r.rankOf('meja'), 9);
});

test('loadVectors: identical vectors share one rank; words with no vector are out of range', async () => {
  const space = await loadVectors(FIXTURE);
  const r = space.ranker('tangga');
  assert.equal(r.rankOf('kursi'), r.rankOf('bangku'), 'a tie');
  assert.equal(r.rankOf('kursi'), r.rankOf('laut'), 'zero similarity ties too');
  assert.equal(r.rankOf('kursi'), 10);
  assert.equal(r.rankOf('zzzzz'), null, 'a word with no vector has no rank');
});

test('ranker: a secret with no vector gives no ranker', async () => {
  const space = await loadVectors(FIXTURE);
  assert.equal(space.ranker('tidakada'), null);
});
