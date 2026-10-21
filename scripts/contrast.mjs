// WCAG AA contrast check for the colours the overlay and the control page really use.
// Run: npm run contrast   (exit code 1 when a pair is below its threshold)
import { readFileSync } from 'node:fs';

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const tokens = (css, selector) => {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
};

let bad = 0;
function check(group, pairs) {
  console.log(`\n${group}`);
  for (const [label, fg, bg, min = 4.5] of pairs) {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  (need ${min})  ${label}  ${fg} on ${bg}`);
  }
}

// Overlay: dark glass over the dark stage. The glass is at most this light once blended.
const o = tokens(readFileSync(new URL('../public/css/overlay.css', import.meta.url), 'utf8'), ':root');
const glass = '#161d2f';
// A colour at alpha a laid over an opaque background, as hex.
const blend = (fg, bg, a) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
// The guess word sits on a track (white at 5% over the glass). Each fill is translucent; these are its
// strongest points (keep them in step with the .bar-fill rules), and the top-half gloss adds up to 12%
// white where the letters are. The word is large bold text, so its threshold is 3:1.
const track = blend('#ffffff', glass, 0.05);
const FILL = { cold: [o.ice, 0.55], warm: [o.gold, 0.46], hot: [o.ember, 0.62], win: [o.mint, 0.5] };
const fill = (k) => blend(FILL[k][0], track, FILL[k][1]);
const gloss = (bg) => blend('#ffffff', bg, 0.12);
check('Overlay guess track (large text)', [
  ['word on its track', o.text, track],
  ...Object.keys(FILL).flatMap((k) => [
    [`word on the ${k} fill`, o.text, fill(k), 3],
    [`word on the ${k} fill under the gloss`, o.text, gloss(fill(k)), 3],
  ]),
]);
check('Overlay (dark)', [
  ['main text', o.text, glass],
  ['secondary text', o['text-2'], glass],
  ['muted text', o.muted, glass],
  ['ember', o.ember, glass],
  ['ice', o.ice, glass],
  ['gold', o.gold, glass],
  ['mint', o.mint, glass],
  ['tile hit text', '#04281a', o['tile-hit']],
  ['tile near text', '#2c1d00', o['tile-near']],
  ['tile miss text', '#d7deee', o['tile-miss']],
  ['revealed slot (gold)', '#241600', o.gold],
  ['revealed slot (win)', '#032617', o.mint],
  ['revealed slot (end)', '#04141e', o.ice],
  ['revealed slot (gift)', '#3a0016', '#ff9cb7'],
  ['revealed slot (free hint)', '#1a1440', '#d8d0ff'],
  ['hot streak title', '#ffb48a', glass],
  ['gift title', '#ffb3c8', glass],
]);

// Control page: both themes. Light overrides dark.
const c = readFileSync(new URL('../public/css/control.css', import.meta.url), 'utf8');
const dark = tokens(c, ':root {');
const light = { ...dark, ...tokens(c, ':root[data-theme="light"]') };
for (const [name, t] of [['Control page (dark)', dark], ['Control page (light)', light]]) {
  check(name, [
    ['text', t.text, t.surface],
    ['secondary text', t['text-2'], t.surface],
    ['muted text', t.muted, t.surface],
    ['muted text on page', t.muted, t.bg],
    ['ember accent', t.ember, t.surface],
    ['mint', t.mint, t.surface],
    ['gold', t.gold, t.surface],
    ['ice', t.ice, t.surface],
    ['danger', t.danger, t.surface],
    ['primary button text', t['on-ember'], t.ember],
    ['focus ring (3:1 for UI)', t.focus, t.surface, 3],
  ]);
}
console.log(bad ? `\n${bad} pair(s) below AA` : '\nAll pairs pass AA');
process.exit(bad ? 1 : 0);
