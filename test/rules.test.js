import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJoinCommand, parseGuess } from '../src/game/guess.js';
import { letterEntry, scoreLetters, sharedLetters, warmth } from '../src/game/letters.js';
import { closeness, loadVectors, VectorSpace } from '../src/game/vectors.js';
import { helperPoints, speedBonus, streakBonus, winPoints } from '../src/game/points.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('one-word rule: trimmed, lowercased, letters only', () => {
  assert.equal(parseGuess('  Rumah  '), 'rumah');
  assert.equal(parseGuess('LAMPU'), 'lampu');
  assert.equal(parseGuess('kupu-kupu'), 'kupu-kupu');
  for (const bad of ['dua kata', 'rumah!', 'r4mah', '', '   ', '🔥', 'rumah?', '-rumah', 'rumah-', '!!rumah', 'halo semua 👋', null, undefined]) {
    assert.equal(parseGuess(bad), null, String(bad));
  }
});

test('!kata prefix is accepted', () => {
  assert.equal(parseGuess('!rumah'), 'rumah');
  assert.equal(parseGuess(' !Tangga '), 'tangga');
  assert.equal(parseGuess('!'), null);
  assert.equal(parseGuess('! rumah'), null);
});

test('!main is the join command, not a guess', () => {
  assert.ok(isJoinCommand('!main'));
  assert.ok(isJoinCommand('  !MAIN '));
  assert.ok(!isJoinCommand('main'));
  assert.ok(!isJoinCommand('!main yuk'));
});

test('letter colours: green right spot, yellow elsewhere, gray absent', () => {
  assert.deepEqual(scoreLetters('tangga', 'tangga'), ['g', 'g', 'g', 'g', 'g', 'g']);
  assert.deepEqual(scoreLetters('rumah', 'murah'), ['y', 'g', 'y', 'g', 'g']);
  assert.deepEqual(scoreLetters('kopi', 'lampu'), ['x', 'x', 'y', 'x']);
  assert.deepEqual(scoreLetters('lampau', 'lampu'), ['g', 'g', 'g', 'g', 'x', 'y']);
});

test('letter colours respect repeated letters', () => {
  // secret has one "a": only one "a" in the guess may light up
  assert.deepEqual(scoreLetters('aaa', 'bab'), ['x', 'g', 'x']);
  assert.deepEqual(scoreLetters('anak', 'kuda'), ['y', 'x', 'x', 'y']);
  // guess longer or shorter than the secret
  assert.deepEqual(scoreLetters('tanggal', 'tangga'), ['g', 'g', 'g', 'g', 'g', 'g', 'x']);
  assert.deepEqual(scoreLetters('tan', 'tangga'), ['g', 'g', 'g']);
});

test('warmth comes from shared letters; only the secret is 1', () => {
  assert.equal(sharedLetters('anak', 'kuda'), 2);
  assert.equal(warmth('tangga', 'tangga'), 1);
  assert.equal(warmth('xyz', 'tangga'), 0);
  assert.ok(warmth('ganti', 'tangga') > warmth('kopi', 'tangga'));
  assert.ok(warmth('murah', 'rumah') < 1, 'an anagram is hot but not the answer');
  const e = letterEntry('rumah', 'murah');
  assert.equal(e.greens, 3);
  assert.equal(e.shared, 5);
});

test('cosine ranking on a small fixture: the secret is rank 1', async () => {
  const vocab = new Set(['rumah', 'gedung', 'atap', 'pintu', 'kota', 'laut', 'hujan']);
  const vs = await loadVectors(path.join(FIX, 'tiny.vec'), { vocab });
  assert.equal(vs.size, 7, 'xyz123 filtered, duplicate "rumah" dropped');
  const r = vs.ranker('rumah');
  assert.equal(r.rankOf('rumah'), 1);
  assert.equal(r.rankOf('gedung'), 2);
  assert.equal(r.rankOf('atap'), 3);
  assert.equal(r.rankOf('pintu'), 4);
  assert.equal(r.rankOf('kota'), 5);
  assert.ok(r.rankOf('laut') >= 6);
  assert.equal(r.rankOf('sepeda'), null, 'no vector: out of range');
  assert.equal(vs.ranker('sepeda'), null);
  assert.ok(Math.abs(vs.cosine('rumah', 'rumah') - 1) < 1e-6);
});

test('vector file limit and vocab filter', async () => {
  const vs = await loadVectors(path.join(FIX, 'tiny.vec'), { maxLines: 3 });
  assert.deepEqual(vs.words, ['rumah', 'gedung']);
});

test('closeness bar: 1 for the secret, falls with rank', () => {
  assert.equal(closeness(1, 1000), 1);
  assert.ok(closeness(2, 1000) > closeness(50, 1000));
  assert.ok(closeness(1000, 1000) <= 0.01);
  assert.equal(closeness(null, 1000), 0);
  const vs = VectorSpace.fromObject({ a: [1, 0], b: [0, 1] });
  assert.equal(vs.ranker('a').rankOf('b'), 2);
});

test('speed bonus: +50 at 0 s, linear to 0 at 3 minutes', () => {
  assert.equal(speedBonus(0), 50);
  assert.equal(speedBonus(90000), 25);
  assert.equal(speedBonus(36000), 40);
  assert.equal(speedBonus(179999), 0);
  assert.equal(speedBonus(180000), 0);
  assert.equal(speedBonus(300000), 0);
  assert.equal(speedBonus(-5), 50);
});

test('streak bonus: +10 on the 2nd win, +10 more each, capped at +30', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(streakBonus), [0, 10, 20, 30, 30, 30]);
});

test('win points: base 100 + speed + streak; no speed after the 3-minute hint', () => {
  assert.deepEqual(winPoints({ elapsedMs: 0, streak: 1 }), { base: 100, speed: 50, streak: 0, total: 150 });
  assert.deepEqual(winPoints({ elapsedMs: 90000, streak: 2 }), { base: 100, speed: 25, streak: 10, total: 135 });
  assert.deepEqual(winPoints({ elapsedMs: 200000, streak: 1 }), { base: 100, speed: 0, streak: 0, total: 100 });
});

test('helper points: rank 2-3 = 10, rank 4-10 = 5, otherwise 0', () => {
  assert.deepEqual([1, 2, 3, 4, 10, 11, null].map(helperPoints), [0, 10, 10, 5, 5, 0, 0]);
});
