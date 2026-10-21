// Game-feel features: commands, free hint, hot streak, close call, recap, difficulty,
// the streamer guard and panic. Time is injected, so a whole round runs in microseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE, RULES } from '../src/game/game.js';
import { parseCommand, parseGuess } from '../src/game/guess.js';
import { VectorSpace } from '../src/game/vectors.js';
import { buildKbbi, cleanMeaning } from '../src/kbbi.js';
import { buildTiers } from '../src/secrets.js';
import { FX_NAMES, sanitize } from '../src/settings.js';
import { EFFECTS, FX_GROUPS } from '../public/js/audio.js';

const WORDS = ['tangga', 'rumah', 'lampu', 'gedung', 'atap', 'ganti', 'tanah', 'kopi', 'pintu', 'kota', 'laut', 'jalan', 'hujan', 'murah', 'tangan', 'sungai', 'rumput', 'pelita', 'lapang', 'sakit', 'padang', 'pasang', 'kantor'];

function makeGame({ secrets = ['tangga'], vectors = null, settings = {}, rng = () => 0.5, streamer = '', tiers = null, rules = {} } = {}) {
  const clock = { t: 1_000_000 };
  const dict = {
    has: (w) => WORDS.includes(w),
    wordClass: () => 'Nomina',
    meaning: (w) => (w === 'tangga' ? 'alat untuk naik atau turun' : null),
  };
  const game = new Game({
    dict,
    secrets,
    vectors,
    tiers,
    streamer,
    settings: { cooldownMs: 0, hintGift: 'Rose', mode: 'letters', ...settings },
    rules,
    now: () => clock.t,
    rng,
  });
  const events = [];
  game.on('evt', (e) => events.push(e));
  const advance = (ms, step = 250) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + step);
      game.tick();
    }
  };
  return { game, clock, events, advance, of: (type) => events.filter((e) => e.type === type) };
}

const u = (id, extra = {}) => ({ id, name: id, ...extra });

// ------------------------------------------------------------------ parsing
test('parseCommand knows the five commands and nothing else', () => {
  for (const c of ['main', 'hint', 'top', 'streak', 'ronde']) assert.equal(parseCommand(`!${c}`), c);
  assert.equal(parseCommand('  !HINT '), 'hint');
  assert.equal(parseCommand('!rumah'), null, 'a normal !word stays a guess');
  assert.equal(parseCommand('hint'), null, 'a command needs the !');
  assert.equal(parseCommand('!hint please'), null);
  assert.equal(parseGuess('!rumah'), 'rumah');
});

// ------------------------------------------------------------------ KBBI meaning
test('cleanMeaning keeps the first sense, drops its number and cuts long text', () => {
  assert.equal(cleanMeaning('1. alat untuk naik | 2. tempat duduk'), 'alat untuk naik');
  assert.equal(cleanMeaning('(1) alat\nsense two'), 'alat');
  assert.equal(cleanMeaning('  \n | '), null);
  const long = cleanMeaning(`${'kata '.repeat(60)}akhir`);
  assert.ok(long.length <= 141 && long.endsWith('…'));
});

test('buildKbbi keeps a meaning only for the words asked for', () => {
  const csv = 'kata,tags_kelas,makna\nrumah,Nomina,"bangunan untuk tempat tinggal"\nlampu,Nomina,"alat penerang"\n';
  const d = buildKbbi(csv, { meaningFor: ['rumah'] });
  assert.equal(d.meaning('rumah'), 'bangunan untuk tempat tinggal');
  assert.equal(d.meaning('lampu'), null);
  assert.equal(buildKbbi(csv).meaning('rumah'), null, 'no list, no meanings (saves memory)');
});

// ------------------------------------------------------------------ free hint
test('!hint opens after one minute, once per round, for the whole stream', () => {
  const { game, advance, of } = makeGame();
  game.startRound();
  assert.equal(game.handleChat(u('a'), '!hint'), 'hint-early');
  assert.equal(of('hint').length, 0);
  assert.equal(of('cmd')[0].cmd, 'hint-wait');
  advance(RULES.freeHintAfterMs);
  assert.equal(game.handleChat(u('a'), '!hint'), 'hint-free');
  const hint = of('hint').find((e) => e.kind === 'free');
  assert.equal(hint.user.id, 'a');
  assert.ok(hint.index > 0, 'the first letter stays for the 3-minute hint');
  assert.equal(game.round.revealed.get(hint.index), 'free');
  assert.equal(game.handleChat(u('b'), '!hint'), 'hint-used', 'another viewer cannot open a second one');
  assert.equal(game.round.giftCount, 0, 'it does not use up the gift hints');
});

test('!hint never opens the last hidden letter, and can be switched off', () => {
  const { game, advance } = makeGame({ secrets: ['kopi'], rng: () => 0 });
  game.startRound();
  advance(RULES.freeHintAfterMs);
  // open letters until only one hidden letter other than the first remains
  game.round.revealed.set(1, 'gift');
  game.round.revealed.set(2, 'gift');
  assert.equal(game.handleChat(u('a'), '!hint'), 'no-letters');

  const off = makeGame({ settings: { freeHint: false } });
  off.game.startRound();
  off.advance(RULES.freeHintAfterMs);
  assert.equal(off.game.handleChat(u('a'), '!hint'), 'hint-off');
  assert.equal(off.game.handleChat(u('a'), '!hint'), 'hint-off');
});

test('!hint does nothing outside a round', () => {
  const { game } = makeGame();
  assert.equal(game.handleChat(u('a'), '!hint'), 'not-playing');
});

// ------------------------------------------------------------------ other commands
test('!top, !streak and !ronde each answer with an overlay card, throttled', () => {
  const { game, clock, of } = makeGame();
  game.startRound();
  game.handleChat(u('w', { name: 'Wina' }), 'tangga'); // a win, so the board has someone
  assert.equal(game.handleChat(u('a'), '!top'), 'top');
  const top = of('cmd').find((e) => e.cmd === 'top');
  assert.equal(top.leaders[0].id, 'w');
  assert.equal(game.handleChat(u('b'), '!top'), 'throttled', 'one !top card per 6 s for the whole chat');
  clock.t += RULES.commandGlobalMs;
  assert.equal(game.handleChat(u('a'), '!top'), 'throttled', 'one per viewer per 20 s');
  clock.t += RULES.commandUserMs;
  assert.equal(game.handleChat(u('a'), '!top'), 'top');

  assert.equal(game.handleChat(u('w'), '!streak'), 'streak');
  const st = of('cmd').find((e) => e.cmd === 'streak');
  assert.equal(st.streak, 1);
  assert.equal(st.wins, 1);

  assert.equal(game.handleChat(u('z'), '!ronde'), 'ronde');
  const ronde = of('cmd').find((e) => e.cmd === 'ronde');
  assert.equal(ronde.phase, PHASE.BREAK);
  assert.equal(ronde.endsAt, game.breakEndsAt);
});

test('!ronde during a round points at the 6-minute mark', () => {
  const { game, of } = makeGame();
  const r = game.startRound();
  game.handleChat(u('a'), '!ronde');
  assert.equal(of('cmd').find((e) => e.cmd === 'ronde').endsAt, r.startedAt + RULES.revealMs);
});

// ------------------------------------------------------------------ hot streak
test('a hot streak fires after 8 guesses in 10 seconds, then waits out its cooldown', () => {
  const { game, clock, of } = makeGame();
  game.startRound();
  const words = WORDS.filter((w) => w.length === 6 && w !== 'tangga'); // same length as the answer
  for (let i = 0; i < 7; i++) {
    game.handleChat(u(`v${i}`), words[i]);
    clock.t += 500;
  }
  assert.equal(of('hot').length, 0, 'seven is not enough');
  game.handleChat(u('v7'), words[7]);
  assert.equal(of('hot').length, 1);
  assert.equal(of('hot')[0].count, 8);
  assert.equal(of('hot')[0].until, clock.t + RULES.hotHoldMs);
  game.handleChat(u('v8'), words[8]);
  assert.equal(of('hot').length, 1, 'cooldown: no second one straight away');
});

test('slow guessing never counts as a hot streak', () => {
  const { game, clock, of } = makeGame();
  game.startRound();
  for (const w of WORDS.filter((x) => x !== 'tangga')) {
    game.handleChat(u(`s-${w}`), w);
    clock.t += 3000;
  }
  assert.equal(of('hot').length, 0);
});

// ------------------------------------------------------------------ close call
test('close call: rank 2 or 3, never the answer itself, once per round', () => {
  const vectors = VectorSpace.fromObject({
    tangga: [1, 0, 0],
    rumah: [0.95, 0.05, 0],
    atap: [0.9, 0.2, 0],
    gedung: [0.85, 0.3, 0],
    pintu: [0.6, 0.6, 0],
    kota: [0.5, 0.5, 0.5],
    laut: [0, 1, 0],
  });
  const { game, of } = makeGame({ vectors });
  game.startRound();
  game.handleChat(u('a'), 'laut');
  game.handleChat(u('b'), 'gedung'); // rank 4
  assert.equal(of('close').length, 0);
  game.handleChat(u('c'), 'atap'); // rank 3
  assert.equal(of('close').length, 1);
  assert.equal(of('close')[0].entry.rank, 3);
  game.handleChat(u('d'), 'rumah'); // rank 2: already had one this round
  assert.equal(of('close').length, 1);
  game.handleChat(u('e'), 'tangga');
  assert.equal(of('close').length, 1, 'the winning guess is not a close call');
});

// ------------------------------------------------------------------ recap
test('the win event carries a recap: meaning, counts, runner-up and the first hint', () => {
  const vectors = VectorSpace.fromObject({
    tangga: [1, 0, 0],
    tangan: [0.9, 0.3, 0],
    sungai: [0, 1, 0],
    gedung: [0.7, 0.7, 0],
  });
  const { game, advance, of } = makeGame({ vectors });
  game.startRound();
  game.handleChat(u('a'), 'sungai');
  game.handleChat(u('b'), 'tangan');
  advance(RULES.freeHintAfterMs);
  game.handleChat(u('c'), '!hint');
  game.handleChat(u('d'), 'gedung');
  game.handleChat(u('e', { name: 'Eka' }), 'tangga');
  const { recap } = of('win')[0];
  assert.equal(recap.word, 'tangga');
  assert.equal(recap.meaning, 'alat untuk naik atau turun');
  assert.equal(recap.guessCount, 4);
  assert.equal(recap.players, 4);
  assert.equal(recap.runnerUp.word, 'tangan', 'closest guess that was not the answer');
  assert.equal(recap.runnerUp.user.id, 'b');
  assert.equal(recap.firstHint.how, 'free');
  assert.equal(recap.firstHint.user.id, 'c');
  assert.equal(game.round.result.recap.word, 'tangga');
});

test('a timeout reveal has a recap too, with nobody to thank and no hint', () => {
  const { game, advance, of } = makeGame();
  game.startRound();
  advance(RULES.revealMs);
  const rev = of('reveal')[0];
  assert.equal(rev.reason, 'timeout');
  assert.equal(rev.recap.guessCount, 0);
  assert.equal(rev.recap.runnerUp, null);
  assert.equal(rev.recap.firstHint.how, 'first', 'the 3-minute letter counts as the first hint');
});

test('the recap never appears in the public state during a round', () => {
  const { game } = makeGame();
  game.startRound();
  game.handleChat(u('a'), 'kopi');
  const s = JSON.stringify(game.publicState());
  assert.ok(!s.includes('tangga'), 'the secret must not be in the public state');
  assert.ok(!s.includes('recap'));
});

// ------------------------------------------------------------------ difficulty
test('buildTiers: files win, otherwise easy is short words and hard is long ones', () => {
  const short = Array.from({ length: 25 }, (_, i) => `ab${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i * 7) % 26))}`);
  const long = Array.from({ length: 25 }, (_, i) => `abcdefgh${String.fromCharCode(97 + (i % 26))}x`);
  const list = [...new Set([...short, ...long, 'sedang'])];
  const t = buildTiers(list);
  assert.ok(t.easy.every((w) => w.length <= 5) && t.easy.length >= 20);
  assert.ok(t.hard.every((w) => w.length >= 8) && t.hard.length >= 20);
  assert.equal(t.normal, list);
  const tiny = buildTiers(['kopi', 'rumah', 'tangga']);
  assert.deepEqual(tiny.easy, ['kopi', 'rumah', 'tangga'], 'too few easy words: use the whole list');
  assert.deepEqual(buildTiers(list, { easy: ['x1'], hard: ['x2'] }).hard, ['x2'], 'explicit files win');
});

test('difficulty picks from its pool, from the next round on', () => {
  const tiers = { easy: ['kopi'], normal: ['kopi', 'tangga', 'rumah'], hard: ['tangga'] };
  const { game } = makeGame({ secrets: tiers.normal, tiers, settings: { difficulty: 'easy' } });
  assert.equal(game.startRound().secret, 'kopi');
  game.settings.difficulty = 'hard';
  assert.equal(game.round.secret, 'kopi', 'the running round is not changed');
  assert.equal(game.skip().secret, 'tangga');
  assert.equal(game.controlState().difficulty, 'hard');
  assert.deepEqual(game.controlState().tierCounts, { easy: 1, normal: 3, hard: 1 });
  game.settings.difficulty = 'nonsense';
  assert.equal(game.difficulty, 'normal');
});

// ------------------------------------------------------------------ streamer guard
test("the streamer's own correct guess is ignored unless they allow it", () => {
  const { game, of } = makeGame({ streamer: 'Osas' });
  game.startRound();
  assert.equal(game.handleChat(u('1', { name: 'osas' }), 'tangga'), 'streamer');
  assert.equal(game.phase, PHASE.PLAYING, 'the round carries on');
  assert.equal(game.round.guesses.length, 0, 'and the answer is not put on the board');
  assert.equal(game.handleChat(u('2', { name: 'viewer' }), 'tangga'), 'win');
  assert.equal(of('win').length, 1);

  const ok = makeGame({ streamer: '@osas', settings: { streamerCanWin: true } });
  ok.game.startRound();
  assert.equal(ok.game.handleChat(u('1', { name: 'osas' }), 'tangga'), 'win');
});

test("the streamer's wrong guesses still count as normal guesses", () => {
  const { game } = makeGame({ streamer: 'osas' });
  game.startRound();
  assert.equal(game.handleChat(u('1', { name: 'osas' }), 'gedung'), 'guess');
});

// ------------------------------------------------------------------ thank-you gifts
test('gifts other than the hint gift only produce a thank-you event', () => {
  const { game, of } = makeGame();
  game.startRound();
  assert.equal(game.handleGift(u('a'), 'Galaxy', 2), 'other-gift');
  const g = of('gift')[0];
  assert.equal(g.gift, 'Galaxy');
  assert.equal(g.count, 2);
  assert.equal(of('hint').length, 0);
  game.handleGift(u('b'), 'Rose');
  assert.equal(of('hint').length, 1, 'the hint gift still opens a letter');
  assert.equal(of('gift').length, 1, 'and does not get a thank-you event on top');
  assert.equal(game.handleGift(u('b'), 'Rose'), 'hint', 'the same viewer may gift again');
  game.handleGift(u('c'), 'Rose');
  assert.equal(game.handleGift(u('d'), 'Rose'), 'round-limit');
  assert.equal(of('gift').length, 2, 'a hint gift that cannot open a letter still gets thanked');
});

test('gift hints: a viewer limit below the round total still applies', () => {
  const { game } = makeGame({ rules: { giftHintsPerViewer: 1 } });
  game.startRound();
  assert.equal(game.handleGift(u('a'), 'Rose'), 'hint');
  assert.equal(game.handleGift(u('a'), 'Rose'), 'viewer-limit');
  assert.equal(game.handleGift(u('b'), 'Rose'), 'hint');
});

test('any length is accepted: the ranking, not the length, decides', () => {
  const vectors = VectorSpace.fromObject({ tangga: [1, 0, 0], tangan: [0.9, 0.3, 0] });
  const { game, of } = makeGame({ vectors });
  game.startRound();
  assert.equal(game.handleChat(u('a'), 'kopi'), 'guess', 'a 4-letter word with no vector');
  assert.equal(game.handleChat(u('b'), 'tangan'), 'guess', 'a 6-letter word with a vector');
  assert.deepEqual(of('guess').map((e) => e.entry.word), ['kopi', 'tangan']);
  assert.equal(of('guess')[0].entry.outOfRange, true);
});

// ------------------------------------------------------------------ panic
test('panic freezes the clock, ignores chat and hides the round; resuming gives the time back', () => {
  const { game, clock, advance, of } = makeGame();
  const r = game.startRound();
  game.handleChat(u('a'), 'kopi');
  advance(30000);
  const before = clock.t - r.startedAt;
  assert.equal(game.freeze(), true);
  assert.equal(game.freeze(), false, 'already frozen');
  assert.equal(game.publicState().panic, true);
  assert.equal(game.publicState().round, null, 'nothing about the round is public');
  assert.equal(game.controlState().secret, null, 'the control page hides the answer too');
  assert.equal(game.handleChat(u('b'), 'tangga'), 'frozen', 'a win cannot land while frozen');
  assert.equal(game.handleChat(u('b'), '!top'), 'frozen');
  assert.equal(game.handleGift(u('c'), 'Rose'), 'frozen');
  advance(RULES.revealMs); // an hour of panic would not end the round
  assert.equal(game.phase, PHASE.PLAYING);
  assert.equal(game.unfreeze(), true);
  assert.equal(clock.t - game.round.startedAt, before, 'the paused time is not counted');
  assert.equal(game.controlState().secret, 'tangga');
  assert.deepEqual(of('panic').map((e) => e.on), [true, false]);
});

test('panic during the break pushes the next round back by the pause', () => {
  const { game, clock, advance } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  game.handleChat(u('a'), game.round.secret);
  advance(5000);
  const left = game.breakEndsAt - clock.t;
  game.freeze();
  advance(60000);
  assert.equal(game.phase, PHASE.BREAK);
  game.unfreeze();
  assert.equal(game.breakEndsAt - clock.t, left);
});

// ------------------------------------------------------------------ settings
test('new settings are validated', () => {
  assert.deepEqual(sanitize({ difficulty: 'hard', freeHint: 0, streamerCanWin: 1, reduceFlash: true, sceneSafe: 'x' }), {
    difficulty: 'hard',
    freeHint: false,
    streamerCanWin: true,
    reduceFlash: true,
    sceneSafe: true,
  });
  assert.deepEqual(sanitize({ difficulty: 'impossible' }), {});
  assert.deepEqual(sanitize({ mutedFx: ['tick', 'tick', 'nope', 7] }), { mutedFx: ['tick'] });
  assert.deepEqual(sanitize({ mutedFx: 'tick' }), { mutedFx: [] });
});

test('the sound effects on the control page match the settings the server accepts', () => {
  assert.deepEqual([...FX_GROUPS].sort(), [...FX_NAMES].sort(), 'every effect has a mute switch and a server-side name');
  for (const e of EFFECTS) assert.ok(FX_NAMES.includes(e.fx), `${e.id} belongs to a known effect`);
  assert.equal(new Set(EFFECTS.map((e) => e.id)).size, EFFECTS.length, 'preview ids are unique');
});
