import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE, RULES } from '../src/game/game.js';
import { VectorSpace } from '../src/game/vectors.js';
import { ScoreStore } from '../src/scores.js';

const WORDS = ['tangga', 'rumah', 'lampu', 'gedung', 'atap', 'ganti', 'tanah', 'kopi', 'pintu', 'kota', 'laut', 'jalan', 'hujan', 'murah', 'tangan', 'sungai', 'rumput', 'pelita'];

function makeGame({ secrets = ['tangga'], vectors = null, settings = {}, rng = () => 0.5, scores = null, rules = {} } = {}) {
  const clock = { t: 1_000_000 };
  const dict = { has: (w) => WORDS.includes(w), wordClass: (w) => (w === 'tangga' || w === 'rumah' ? 'Nomina' : null) };
  const game = new Game({ dict, secrets, vectors, settings: { cooldownMs: 2000, hintGift: 'Rose', mode: 'letters', ...settings }, scores, now: () => clock.t, rng, rules });
  const events = [];
  const replies = [];
  game.on('evt', (e) => events.push(e));
  game.on('reply', (r) => replies.push(r));
  const advance = (ms, step = 250) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + step);
      game.tick();
    }
  };
  return { game, clock, events, replies, advance, of: (type) => events.filter((e) => e.type === type) };
}

const u = (id, extra = {}) => ({ id, name: id, ...extra });

test('round state machine: idle -> playing -> break -> playing', () => {
  const { game, advance, of } = makeGame({ secrets: ['tangga', 'rumah'] });
  assert.equal(game.phase, PHASE.IDLE);
  assert.equal(game.handleChat(u('a'), 'tangga'), 'not-playing');
  game.startRound();
  assert.equal(game.phase, PHASE.PLAYING);
  const first = game.round.secret;
  game.handleChat(u('a'), first);
  assert.equal(game.phase, PHASE.BREAK);
  assert.equal(game.handleChat(u('b'), 'rumah'), 'not-playing', 'no guesses during the break');
  advance(RULES.breakMs - 250);
  assert.equal(game.phase, PHASE.BREAK);
  advance(250);
  assert.equal(game.phase, PHASE.PLAYING, 'next round after exactly 15 s');
  assert.notEqual(game.round.secret, first, 'never the same word twice in a row');
  assert.equal(of('round').length, 2);
});

test('break lasts 15 seconds after a win and after a reveal', () => {
  const { game, clock, of } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  const secret = game.round.secret;
  game.reveal();
  assert.equal(game.phase, PHASE.BREAK);
  assert.equal(of('break')[0].endsAt, clock.t + 15000);
  assert.equal(of('reveal')[0].word, secret);
});

test('guess validation: one word, !kata prefix, junk ignored', () => {
  const { game } = makeGame();
  game.startRound();
  assert.equal(game.handleChat(u('a'), 'halo semua'), 'ignored');
  assert.equal(game.handleChat(u('b'), '😂😂'), 'ignored');
  assert.equal(game.handleChat(u('c'), '!gedung'), 'guess');
  assert.equal(game.handleChat(u('d'), '  TANGAN '), 'guess');
  assert.deepEqual(game.round.guesses.map((g) => g.word), ['gedung', 'tangan']);
});

test('words not in KBBI get a private reply and no penalty', () => {
  const { game, replies, advance } = makeGame();
  game.startRound();
  assert.equal(game.handleChat(u('a'), 'qwerty'), 'invalid');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, 'Kata tidak ada dalam KBBI.');
  assert.equal(replies[0].user.id, 'a');
  assert.equal(game.round.guesses.length, 0, 'not on the board');
  advance(2000);
  assert.equal(game.handleChat(u('a'), 'gedung'), 'guess');
  game.settings.lang = 'en';
  advance(2000);
  game.handleChat(u('a'), 'qwertz');
  assert.equal(replies[1].text, 'That word is not in KBBI.');
});

test('cooldown: one guess per viewer every 2 s, extras ignored silently', () => {
  const { game, advance, replies } = makeGame();
  game.startRound();
  assert.equal(game.handleChat(u('a'), 'gedung'), 'guess');
  assert.equal(game.handleChat(u('a'), 'tangan'), 'cooldown');
  assert.equal(game.handleChat(u('a'), 'qwerty'), 'cooldown', 'no KBBI reply during the cooldown');
  assert.equal(replies.length, 0);
  assert.equal(game.handleChat(u('b'), 'tangan'), 'guess', 'other viewers are not affected');
  advance(1999, 1999);
  assert.equal(game.handleChat(u('a'), 'sungai'), 'cooldown');
  advance(1, 1);
  assert.equal(game.handleChat(u('a'), 'sungai'), 'guess');
  game.settings.cooldownMs = 0;
  assert.equal(game.handleChat(u('a'), 'pelita'), 'guess', 'cooldown is editable');
});

test('duplicates: a word already on the board is ignored', () => {
  const { game, advance } = makeGame();
  game.startRound();
  game.handleChat(u('a'), 'gedung');
  assert.equal(game.handleChat(u('b'), 'gedung'), 'duplicate');
  advance(2000);
  assert.equal(game.handleChat(u('a'), '!GEDUNG'), 'duplicate');
  assert.equal(game.round.guesses.length, 1);
});

test('the board is best first (rank) and marks the newest guess', () => {
  const { game, of } = vectorGame();
  game.startRound();
  game.handleChat(u('a'), 'laut');
  game.handleChat(u('b'), 'gedung');
  game.handleChat(u('c'), 'rumah');
  const st = game.publicState();
  assert.deepEqual(st.round.board.map((e) => e.word), ['rumah', 'gedung', 'laut']);
  assert.equal(st.round.newest.word, 'rumah');
  assert.equal(st.round.lastWord, 'rumah');
  assert.equal(st.round.guessCount, 3);
  assert.equal(st.round.heat, st.round.board[0].closeness, 'the heat follows the closest guess');
  assert.ok(of('guess')[0].first);
  assert.ok(!of('guess')[1].first);
});

test('hints: length and class at start, first letter at 3 min, reveal at 6 min', () => {
  const { game, advance, of } = makeGame();
  game.startRound();
  let st = game.publicState();
  assert.equal(st.round.length, 6);
  assert.equal(st.round.wordClass, 'Nomina');
  assert.deepEqual(st.round.revealed, []);
  advance(179750);
  assert.equal(of('hint').length, 0);
  advance(250);
  assert.equal(of('hint').length, 1);
  assert.deepEqual(of('hint')[0], { type: 'hint', kind: 'first', index: 0, letter: 't' });
  st = game.publicState();
  assert.deepEqual(st.round.revealed, [{ i: 0, ch: 't', how: 'first' }]);
  advance(179750);
  assert.equal(game.phase, PHASE.PLAYING);
  advance(250);
  assert.equal(game.phase, PHASE.BREAK);
  assert.equal(of('reveal')[0].reason, 'timeout');
  assert.equal(game.leaderboard().length, 0, 'no points on a timeout');
  assert.equal(game.publicState().round.result.word, 'tangga');
});

test('unknown word class is reported as null (overlay shows "tidak diketahui")', () => {
  const { game } = makeGame({ secrets: ['lampu'] });
  game.startRound();
  assert.equal(game.publicState().round.wordClass, null);
});

test('the overlay state never contains the secret during a round', () => {
  const { game } = makeGame();
  game.startRound();
  game.handleChat(u('a'), 'rumah');
  assert.ok(!JSON.stringify(game.publicState()).includes('tangga'));
  assert.equal(game.controlState().secret, 'tangga');
});

test('winning: base 100 + speed bonus, ends the round', () => {
  const { game, advance, of } = makeGame();
  game.startRound();
  advance(90000);
  assert.equal(game.handleChat(u('a'), 'tangga'), 'win');
  const win = of('win')[0];
  assert.deepEqual(win.points, { base: 100, speed: 25, streak: 0, total: 125 });
  assert.equal(win.winner.id, 'a');
  assert.equal(game.leaderboard()[0].points, 125);
  assert.equal(game.leaderboard()[0].wins, 1);
});

test('after the 3-minute hint a win is base 100 only', () => {
  const { game, advance, of } = makeGame();
  game.startRound();
  advance(200000);
  game.handleChat(u('a'), 'tangga');
  assert.deepEqual(of('win')[0].points, { base: 100, speed: 0, streak: 0, total: 100 });
});

test('streaks: +10 on the 2nd win, +20 on the 3rd, capped at +30, broken by another winner', () => {
  const { game, advance, of } = makeGame({ secrets: ['tangga', 'rumah'] });
  const winRound = (id) => {
    game.startRound();
    advance(180000); // no speed bonus, to isolate the streak
    game.handleChat(u(id), game.round.secret);
    return of('win').at(-1).points.streak;
  };
  assert.deepEqual(['a', 'a', 'a', 'a', 'a'].map(winRound), [0, 10, 20, 30, 30]);
  assert.equal(of('streak').at(-1).count, 5);
  assert.equal(winRound('b'), 0);
  assert.equal(winRound('a'), 0, 'streak ended when b won');
});

test('a timeout does not break a streak', () => {
  const { game, advance, of } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  game.handleChat(u('a'), game.round.secret);
  advance(15000);
  advance(360000);
  advance(15000);
  game.handleChat(u('a'), game.round.secret);
  assert.equal(of('win').at(-1).streak, 2);
});

test('gift hints: configured gift only, one per round, extra Roses queue for later rounds, no points', () => {
  const { game, of } = makeGame({ secrets: ['tangga'], rng: () => 0 });
  game.startRound();
  assert.equal(game.handleGift(u('a'), 'Galaxy'), 'other-gift');
  assert.equal(game.handleGift(u('a'), 'rose'), 'hint', 'name match ignores case');
  assert.equal(game.handleGift(u('a'), 'Rose'), 'queued', 'one Rose per round: the next one waits');
  assert.equal(game.handleGift(u('b'), 'Rose'), 'queued');
  assert.equal(game.handleGift(u('c'), 'Rose'), 'queued');
  assert.equal(of('hint').length, 1, 'only the first Rose opens a letter this round');
  assert.equal(game.controlState().giftQueue, 3, 'three Roses wait in line');
  assert.equal(game.leaderboard().length, 0, 'gift hints never award points');
  // the queue opens one letter per round, first in line first
  game.reveal();
  game.startRound();
  const hints = of('hint');
  assert.equal(hints.length, 2);
  assert.equal(hints[1].user.id, 'a', 'the first queued Rose opens the next round');
  assert.equal(hints[1].kind, 'gift');
  assert.ok(hints.every((h) => h.index !== 0), 'first letter is saved for the 3-minute hint');
  assert.equal(game.controlState().giftQueue, 2);
  assert.equal(game.handleGift(u('d'), 'Rose'), 'queued', 'the round already has its one gift hint');
});

test('gift hint name is editable', () => {
  const { game } = makeGame();
  game.startRound();
  game.settings.hintGift = 'Donut';
  assert.equal(game.handleGift(u('a'), 'Rose'), 'other-gift');
  assert.equal(game.handleGift(u('a'), 'Donut'), 'hint');
});

test('gift hints never reveal the whole word', () => {
  const { game, advance } = makeGame({ secrets: ['atap'], rng: () => 0 });
  game.startRound();
  game.round.revealed.set(1, 'gift');
  game.round.revealed.set(2, 'gift');
  assert.equal(game.handleGift(u('a'), 'Rose'), 'queued', 'only one hidden letter besides the first is left, so the Rose waits');
  advance(180000);
  const hidden = 4 - game.publicState().round.revealed.length;
  assert.equal(hidden, 1, 'the last letter is never opened');
});

test('gift during the break waits in the queue and opens a letter in the next round', () => {
  const { game, of } = makeGame();
  game.startRound();
  game.reveal();
  assert.equal(game.handleGift(u('a'), 'Rose'), 'queued');
  assert.equal(of('hint').length, 0, 'nothing opens during the break');
  game.startRound();
  assert.equal(of('hint').length, 1);
  assert.equal(of('hint')[0].user.id, 'a');
});

test('the gift queue is bounded: Roses beyond giftQueueMax are thanked and dropped', () => {
  const { game, of } = makeGame({ rules: { giftQueueMax: 2 } });
  game.startRound();
  game.handleGift(u('a'), 'Rose'); // opens a letter
  assert.equal(game.handleGift(u('b'), 'Rose'), 'queued');
  assert.equal(game.handleGift(u('c'), 'Rose'), 'queued');
  assert.equal(game.handleGift(u('d'), 'Rose'), 'queue-full');
  assert.equal(of('gift').length, 3, 'every Rose that cannot open a letter still gets a thank-you');
  assert.equal(game.controlState().giftQueue, 2);
});

function vectorGame(opts = {}) {
  const vectors = VectorSpace.fromObject({
    tangga: [1, 0, 0],
    rumah: [0.95, 0.05, 0],
    atap: [0.9, 0.2, 0],
    gedung: [0.85, 0.3, 0],
    pintu: [0.6, 0.6, 0],
    kota: [0.5, 0.5, 0.5],
    laut: [0, 1, 0],
  });
  return makeGame({ vectors, settings: { mode: 'vector' }, ...opts });
}

test('ranking: rank by cosine, "di luar jangkauan" for words without a vector', () => {
  const { game } = vectorGame();
  game.startRound();
  game.handleChat(u('a'), 'laut');
  game.handleChat(u('b'), 'rumah');
  game.handleChat(u('c'), 'kopi'); // valid KBBI word, no vector
  const board = game.publicState().round.board;
  assert.deepEqual(board.map((e) => [e.word, e.rank]), [['rumah', 2], ['laut', 7], ['kopi', null]]);
  assert.equal(board[2].outOfRange, true);
  assert.equal(game.round.guesses.length, 3, 'still counts as a guess');
});

test('no vectors: the round still runs, every guess is out of range, and the streamer sees a note', () => {
  const { game } = makeGame();
  const notes = [];
  game.on('note', (n) => notes.push(n.text));
  game.startRound();
  assert.equal(game.round.ranker, null);
  game.handleChat(u('a'), 'gedung');
  const e = game.round.guesses[0];
  assert.equal(e.rank, null);
  assert.equal(e.outOfRange, true);
  assert.equal(e.closeness, 0);
  assert.deepEqual(notes, [], 'no note for a plain no-vectors run; the status line says so');
});

test('session board ties go to whoever reached the total first', () => {
  const { game, advance } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  advance(180000);
  game.handleChat(u('first'), game.round.secret); // 100
  advance(15000);
  advance(180000);
  game.handleChat(u('second'), game.round.secret); // 100, later
  assert.deepEqual(game.leaderboard().map((s) => s.id), ['first', 'second']);
});

test('simulator players: session points, marked SIM, never on the all-time board', () => {
  const scores = new ScoreStore(null);
  const { game } = makeGame({ scores, secrets: ['tangga', 'rumah'] });
  game.startRound();
  game.handleChat(u('bot', { sim: true }), game.round.secret);
  assert.equal(game.leaderboard()[0].sim, true);
  assert.equal(scores.players.get('bot').sim, true, 'stored, marked SIM');
  assert.equal(scores.top().length, 0, 'not on the all-time board');
  assert.ok(!scores.toCsv().includes('bot'));
  game.startRound();
  game.handleChat(u('real'), game.round.secret);
  assert.deepEqual(scores.top().map((p) => p.id), ['real']);
});

test('skip starts a new round straight away; reveal shows the word', () => {
  const { game, of } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  game.skip();
  assert.equal(game.phase, PHASE.PLAYING);
  assert.equal(game.round.no, 2);
  assert.equal(of('reveal').length, 0);
  assert.equal(game.reveal(), true);
  assert.equal(game.reveal(), false, 'nothing to reveal during the break');
});

test('streamer override picks the next secret', () => {
  const { game } = makeGame({ secrets: ['tangga', 'rumah'] });
  assert.deepEqual(game.setNextWord('zzzz'), { ok: false, error: 'not-in-kbbi' });
  assert.equal(game.setNextWord(' LAMPU ').ok, true);
  game.startRound();
  assert.equal(game.round.secret, 'lampu');
  game.reveal();
  game.startRound();
  assert.notEqual(game.round.secret, 'lampu', 'override is used once');
});

test('join (!main), follow and like events', () => {
  const { game, of, advance } = makeGame();
  game.startRound();
  assert.equal(game.handleChat(u('a'), '!main'), 'join');
  assert.equal(game.round.guesses.length, 0, '!main is not a guess');
  assert.equal(game.handleChat(u('a'), '!main'), 'join-throttled');
  advance(60000);
  assert.equal(game.handleChat(u('a'), '!main'), 'join');
  assert.equal(game.handleFollow(u('a')), 'follow');
  assert.equal(game.handleFollow(u('a')), 'repeat', 'one follow card per viewer');
  game.handleLike(u('b'), 15);
  assert.equal(of('like')[0].count, 15);
  assert.equal(of('join').length, 2);
});

test('reset session clears scores and streak; clear leaderboard keeps the streak', () => {
  const { game } = makeGame({ secrets: ['tangga', 'rumah'] });
  game.startRound();
  game.handleChat(u('a'), game.round.secret);
  game.clearLeaderboard();
  assert.equal(game.leaderboard().length, 0);
  assert.equal(game.streak.count, 1);
  game.resetSession();
  assert.equal(game.streak.count, 0);
});
