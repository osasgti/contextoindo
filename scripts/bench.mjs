// Simple benchmarks. Run: npm run bench
//
//  1. Server: how long the game takes to handle a flood of chat guesses (always runs).
//  2. Overlay: script cost per frame. Open the overlay with ?bench=1 in any browser and read the
//     box in the top right corner (goal: under 5 ms per frame at 60 fps). If Playwright is
//     installed, this script also drives a headless Chromium through a busy simulated round and
//     prints the same numbers. A software-rendered headless browser is slower than a real
//     laptop, so treat its numbers as an upper bound.
//
//  Optional: BENCH_URL=http://localhost:3000 (a server that is already running with --sim or --demo)
//            CHROME_PATH=/path/to/chrome
import { Game } from '../src/game/game.js';
import { VectorSpace } from '../src/game/vectors.js';

// A synthetic vocabulary: N words of 50 random dimensions, enough to time the ranking
// the way a real vector file would cost it (the real file's ranks are not checked here).
const N = Number(process.env.BENCH_VOCAB) || 50000;
const DIM = 50;
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const wordOf = (i) => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};
const words = Array.from({ length: N }, (_, i) => wordOf(i));
const data = new Float32Array(N * DIM);
for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
const vectors = new VectorSpace(words, DIM, data);

// per round start: the rank table for one secret
const secret = words[1000];
const buildTimes = [];
for (let k = 0; k < 15; k++) {
  const t = performance.now();
  vectors.ranker(words[1000 + k]);
  buildTimes.push(performance.now() - t);
}
buildTimes.sort((a, b) => a - b);
console.log(`ranking: rank table for ${N.toLocaleString()} words x ${DIM} dims, median ${buildTimes[7].toFixed(1)} ms per round start`);

let clock = 1_000_000;
const game = new Game({
  dict: { has: (w) => /^[a-z]+$/.test(w), wordClass: () => 'Nomina', meaning: () => 'contoh' },
  secrets: [secret],
  vectors,
  settings: { cooldownMs: 0, hintGift: 'Rose' },
  now: () => clock,
  rng: () => 0.5,
});
let events = 0;
game.on('evt', () => events++);
game.startRound();

const GUESSES = 20000;
const guessWords = Array.from({ length: 400 }, (_, i) => words[(i * 7919) % N]);
const t0 = performance.now();
for (let i = 0; i < GUESSES; i++) {
  clock += 3; // 333 guesses per second of game time
  game.handleChat({ id: `u${i % 400}`, name: `Viewer ${i % 400}` }, guessWords[i % guessWords.length]);
  if (i % 80 === 0) game.tick();
}
const ms = performance.now() - t0;
console.log(`server: ${GUESSES} ranked guesses from 400 viewers in ${ms.toFixed(0)} ms (${((ms * 1000) / GUESSES).toFixed(2)} µs each, ${events} events)`);

// ---- overlay in a headless browser, when Playwright is around
const url = process.env.BENCH_URL;
let pw = null;
try {
  pw = await import('playwright');
} catch {
  /* not installed: that is fine */
}
if (!pw) {
  console.log('overlay: Playwright is not installed. Open /?bench=1 in your browser (or OBS) and read the box in the corner.');
} else if (!url) {
  console.log('overlay: set BENCH_URL to a running game (npm run sim) to benchmark it, e.g. BENCH_URL=http://localhost:3000 npm run bench');
} else {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${url}/?bench=1&demo=popups`);
  await page.waitForTimeout(15000);
  console.log('overlay (15 s of simulated chat):', JSON.stringify(await page.evaluate('window.__bench()')));
  await browser.close();
}
