import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKbbi, firstTag, loadKbbi, parseCsv } from '../src/kbbi.js';
import { loadSecrets, parseSecretList, pickSecret } from '../src/secrets.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('CSV parser handles quotes, commas, newlines, CRLF and BOM', () => {
  const rows = [];
  parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n1,,3\n,last,\n', (r) => rows.push(r));
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'he said "hi"', 'line1\nline2'],
    ['1', '', '3'],
    ['', 'last', ''],
  ]);
});

test('CSV parser keeps a trailing empty field at end of file', () => {
  const rows = [];
  parseCsv('a,b\n1,', (r) => rows.push(r));
  assert.deepEqual(rows[1], ['1', '']);
});

test('KBBI loads the kata column lowercased into a set', () => {
  const kbbi = loadKbbi(path.join(FIX, 'kbbi_sample.csv'));
  assert.ok(kbbi.size > 150);
  assert.ok(kbbi.has('rumah'));
  assert.ok(kbbi.has('atap'), 'ATAP was lowercased');
  assert.ok(!kbbi.has('ATAP'));
  assert.ok(kbbi.has('kupu-kupu'));
  assert.ok(!kbbi.has('xyzzy'));
});

test('word class is the first value of tags_kelas, first row wins', () => {
  const kbbi = loadKbbi(path.join(FIX, 'kbbi_sample.csv'));
  assert.equal(kbbi.wordClass('rumah'), 'Nomina', 'a later "rumah" row says Verba; the first row wins');
  assert.equal(kbbi.wordClass('makan'), 'Verba');
  assert.equal(kbbi.wordClass('besar'), 'Adjektiva');
  assert.equal(kbbi.wordClass('main'), 'Verba', '"Verba | Nomina" -> Verba');
  assert.equal(kbbi.wordClass('mana'), null, 'missing class');
  assert.equal(firstTag(' | Nomina'), 'Nomina');
  assert.equal(firstTag(''), null);
});

test('KBBI loader explains a missing file', () => {
  assert.throws(() => loadKbbi('/nope/kbbi.csv'), /KBBI CSV not found[\s\S]*KBBI_CSV/);
  assert.throws(() => buildKbbi('foo,bar\n1,2\n'), /no "kata" column/);
});

test('secret list: one word per line, comments and repeats dropped', () => {
  assert.deepEqual(parseSecretList('# header\nRumah\n\nlampu\r\nrumah\n  atap  \n'), ['rumah', 'lampu', 'atap']);
  const list = loadSecrets(path.join(FIX, 'secret_words.txt'));
  assert.ok(list.length >= 20);
  assert.ok(list.every((w) => w === w.toLowerCase() && !w.startsWith('#')));
  assert.throws(() => loadSecrets('/nope/secret_words.txt'), /build_secret_words\.py/);
});

test('every fixture secret is a valid KBBI guess', () => {
  const kbbi = loadKbbi(path.join(FIX, 'kbbi_sample.csv'));
  for (const w of loadSecrets(path.join(FIX, 'secret_words.txt'))) assert.ok(kbbi.has(w), w);
});

test('pickSecret never repeats the previous word', () => {
  const list = ['a', 'b', 'c'];
  let prev = null;
  for (let i = 0; i < 500; i++) {
    const w = pickSecret(list, prev);
    assert.notEqual(w, prev);
    prev = w;
  }
  // even with an rng that keeps hitting the previous word
  assert.equal(pickSecret(['a', 'b'], 'a', () => 0), 'b');
  assert.equal(pickSecret(['solo'], 'solo'), 'solo');
});
