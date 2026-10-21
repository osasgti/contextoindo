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

const WORDS = ['tangga', 'rumah', 'lampu', 'gedung', 'atap', 'ganti', 'tanah', 'kopi', 'pintu', 'kota', 'laut', 'jalan', 'hujan', 'murah', 'tangan', 'kursi', 'meja', 'buku', 'pena', 'kain'];
let clock = 1_000_000;
const game = new Game({
  dict: { has: (w) => /^[a-z]+$/.test(w), wordClass: () => 'Nomina', meaning: () => 'contoh' },
  secrets: ['tangga'],
  settings: { cooldownMs: 0, mode: 'letters', hintGift: 'Rose' },
  now: () => clock,
  rng: () => 0.5,
});
let events = 0;
game.on('evt', () => events++);
game.startRound();

const N = 20000;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  clock += 3; // 333 guesses per second of game time
  game.handleChat({ id: `u${i % 400}`, name: `Viewer ${i % 400}` }, `${WORDS[i % WORDS.length]}${(i % 700).toString(26).replace(/[0-9]/g, (d) => 'qrstuvwxyz'[d])}`);
  if (i % 80 === 0) game.tick();
}
const ms = performance.now() - t0;
console.log(`server: ${N} guesses from 400 viewers in ${ms.toFixed(0)} ms (${((ms * 1000) / N).toFixed(1)} µs each, ${events} events)`);

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
