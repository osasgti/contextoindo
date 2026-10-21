// Overlay: renders the server's public state and turns game events into popups, sound and fx.
import { Net } from './net.js';
import { applyStatic, esc, fmtNum, fmtTime, getLang, setLang, t } from './i18n.js';
import { avatarEl } from './avatar.js';
import { Sound } from './audio.js';
import { Confetti, Hearts } from './fx.js';
import { PopupQueue } from './shared/popup-queue.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const urlLayout = q.get('layout') === 'portrait' || q.get('layout') === 'landscape' ? q.get('layout') : null;
if (q.get('transparent') === '1') document.body.classList.add('transparent');
if (q.get('motion') === '0') document.documentElement.classList.add('reduced-motion');
const urlNoFlash = q.get('flash') === '0';

const S = {
  state: null,
  settings: { lang: 'id', layout: 'landscape', boardTop: 5, hintGift: 'Rose', cooldownMs: 2000, tts: false, freeHint: true, reduceFlash: false, sceneSafe: false, mutedFx: [] },
  offset: 0,
  layout: null,
  slotKey: null,
  revealedSeen: new Set(),
  latestId: null,
  lastCountdown: null,
  lastBeat: null,
  phase: null,
  pointsSeen: new Map(),
  bestHeat: 0,
  heatSent: -1,
  hotUntil: 0,
  hot: false,
  panic: false,
  pulse: 0,
};
const now = () => Date.now() + S.offset;
const noFlash = () => document.body.classList.contains('no-flash');

const sound = new Sound({ music: true });
const confetti = new Confetti($('confetti'));
const hearts = new Hearts($('hearts'));
const popups = new PopupQueue();
const burst = (n) => confetti.burst(noFlash() ? Math.round(n * 0.4) : n);

// ------------------------------------------------------------------ benchmark (?bench=1)
// Counts the time our own script spends per frame: render, clock, popups and the level loop.
const bench = q.get('bench') === '1' ? { work: 0, frames: [], work_ms: [], render: [], calls: [] } : null;
let benchDepth = 0;
function timed(fn, label) {
  if (!bench) return fn();
  const t0 = performance.now();
  benchDepth++;
  try {
    return fn();
  } finally {
    benchDepth--;
    const d = performance.now() - t0;
    if (benchDepth === 0) {
      bench.work += d;
      bench.calls.push([performance.now(), d]);
    }
    if (label === 'render') {
      bench.render.push(d);
      if (bench.render.length > 600) bench.render.shift();
    }
  }
}

// ------------------------------------------------------------------ names (scene-safe mode)
function alias(u) {
  let h = 2166136261;
  for (const ch of String(u?.id ?? '?')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return t('alias', { id: (h >>> 0).toString(36).slice(-3).toUpperCase().padStart(3, '0') });
}
/** The viewer as the overlay may show them: with scene-safe mode on, an alias and no picture. */
const shown = (u) => (S.settings.sceneSafe && u ? { ...u, name: alias(u), nick: null, avatar: null } : u);
const spokenName = (u) => (S.settings.sceneSafe ? alias(u) : u.nick || u.name);
const safeFlag = () => (S.settings.sceneSafe ? '1' : '0');

// ------------------------------------------------------------------ layout + scale
function applyLayout() {
  const layout = urlLayout || S.settings.layout || 'landscape';
  if (layout !== S.layout) {
    S.layout = layout;
    document.body.classList.toggle('layout-portrait', layout === 'portrait');
    document.body.classList.toggle('layout-landscape', layout !== 'portrait');
    fit();
    timed(render, 'render');
  }
}

function fit() {
  const portrait = S.layout === 'portrait';
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;
  const s = Math.min(innerWidth / W, innerHeight / H);
  $('stage').style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fit);

// ------------------------------------------------------------------ heat colour
const ICE = [94, 200, 255];
const GOLD = [255, 207, 92];
const EMBER = [255, 110, 52];
function heatRgb(h) {
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return h < 0.5 ? mix(ICE, GOLD, h / 0.5) : mix(GOLD, EMBER, (h - 0.5) / 0.5);
}
function setHeat(h) {
  const v = Math.max(0, Math.min(1, h || 0));
  const root = document.documentElement.style;
  root.setProperty('--heat', v.toFixed(3));
  root.setProperty('--heat-rgb', heatRgb(v).join(', '));
}

// ------------------------------------------------------------------ render
function render() {
  const st = S.state;
  if (!st) return;
  renderTop(st);
  renderHero(st);
  renderBoard(st);
  renderLeaders(st);
  renderHistory(st);
  renderHowto();
  tickClock();
}

function renderTop(st) {
  const r = st.round;
  $('guessCount').textContent = fmtNum(r?.guessCount ?? 0);
  $('lastWord').textContent = r?.lastWord ?? '–';
  $('modeText').textContent = t('modeVector');
}

function classLabel(cls) {
  return cls ? t(cls) : t('classUnknown');
}

function slotWidth(n, avail) {
  return Math.max(40, Math.min(78, Math.floor((avail - 12 * (n - 1)) / n)));
}

const REVEAL_CLASS = { gift: 'by-gift', free: 'by-free', first: 'by-first' };

function renderHero(st) {
  const r = st.round;
  const hero = $('hero');
  hero.classList.toggle('is-break', st.phase === 'break');
  const slots = $('slots');
  if (!r) {
    $('heroTitle').textContent = t('waitingTitle');
    $('chipLength').textContent = t('letters', { n: '–' });
    $('chipClass').textContent = '–';
    $('chipGift').hidden = true;
    $('chipDiff').hidden = true;
    slots.innerHTML = '';
    S.slotKey = null;
    setHeat(0);
    return;
  }
  $('heroTitle').textContent = r.ended ? t('lastAnswer', { n: r.no }) : t('secretWord');
  $('chipLength').textContent = t('letters', { n: r.length });
  $('chipClass').textContent = classLabel(r.wordClass);
  $('chipClass').className = 'chip chip-class';
  const diff = r.difficulty && r.difficulty !== 'normal' ? r.difficulty : null;
  $('chipDiff').hidden = !diff;
  if (diff) {
    $('chipDiff').textContent = t(diff === 'easy' ? 'diffEasy' : 'diffHard');
    $('chipDiff').dataset.level = diff;
  }
  $('chipGift').hidden = false;
  $('giftLabel').textContent = st.hintGift;
  $('giftPips').innerHTML = Array.from({ length: r.giftsMax }, (_, i) => `<span class="pip${i < r.giftsUsed ? ' on' : ''}"></span>`).join('');

  const key = `${r.no}:${r.length}`;
  if (S.slotKey !== key) {
    S.slotKey = key;
    S.revealedSeen = new Set();
    slots.innerHTML = '';
    const avail = (hero.clientWidth || 1200) - 60;
    const w = slotWidth(r.length, avail);
    for (let i = 0; i < r.length; i++) {
      const s = el('div', 'slot hidden');
      s.style.setProperty('--w', `${w}px`);
      slots.appendChild(s);
    }
  }
  const won = r.result?.reason === 'win';
  const byIndex = new Map(r.revealed.map((x) => [x.i, x]));
  [...slots.children].forEach((s, i) => {
    const x = byIndex.get(i);
    if (!x) {
      s.className = 'slot hidden';
      s.textContent = '';
      return;
    }
    // once the round is over the whole word takes one colour: mint for a win, ice for a reveal
    const how = r.ended ? (won ? 'by-win' : 'by-end') : REVEAL_CLASS[x.how] || 'by-first';
    const seenKey = `${i}:${r.ended ? 'end' : x.how}`;
    const fresh = !S.revealedSeen.has(seenKey);
    S.revealedSeen.add(seenKey);
    s.className = `slot open ${how}`;
    s.textContent = x.ch;
    if (fresh) {
      s.style.setProperty('--d', r.ended ? `${i * 70}ms` : '0ms');
      s.classList.remove('flip');
      s.getBoundingClientRect();
      s.classList.add('flip');
    }
  });
  setHeat(won ? 1 : r.heat);
  // the warmth drone follows the closest guess
  const heat = st.phase === 'playing' && !r.ended ? r.heat || 0 : 0;
  if (Math.abs(heat - S.heatSent) > 0.01) {
    S.heatSent = heat;
    sound.setHeat(heat, st.phase === 'playing');
  }
}

function rowMeter(e) {
  if (e.outOfRange) return `<div class="row-meter"><span class="row-val out" style="grid-column:1/-1;text-align:left">${esc(t('outOfRange'))}</span></div>`;
  return `<div class="row-meter"><div class="bar"><div class="bar-fill"></div></div><span class="row-val"></span></div>`;
}

function buildRow(e) {
  const u = shown(e.user);
  const li = el('li', 'row');
  li.dataset.id = e.id;
  li.dataset.safe = safeFlag();
  li.appendChild(el('span', 'row-pos rank'));
  li.appendChild(avatarEl(u));
  li.appendChild(el('span', 'row-name', esc(u.name)));
  li.appendChild(el('span', 'row-word', `<span class="word-text">${esc(e.word)}</span>`));
  li.insertAdjacentHTML('beforeend', rowMeter(e));
  return li;
}

/** rk: 1 for the best row of the board down to 0 for the last one. It tints and fades the rows. */
function decorateRow(li, e, r, rk = 0.5) {
  const v = e.closeness ?? 0;
  li.style.setProperty('--v', String(e.outOfRange ? 0 : v));
  li.style.setProperty('--rk', rk.toFixed(2));
  li.querySelector('.row-pos').textContent = e.rank != null ? `#${fmtNum(e.rank)}` : '–';
  li.classList.toggle('hot', !e.outOfRange && v >= 0.67);
  li.classList.toggle('warm', !e.outOfRange && v >= 0.34 && v < 0.67);
  li.classList.toggle('is-new', e.id === r.newest?.id);
  li.classList.toggle('is-win', r.result?.reason === 'win' && e.word === r.result.word);
}

/** The tiles of a new row flip over one after another, then green ones bounce. */
function playIn(li) {
  li.classList.add('flip-in');
  setTimeout(() => li.classList.remove('flip-in'), 1700);
}

/** A row that moved up the board leaves a short glowing trail. */
function climb(node) {
  node.classList.remove('climb');
  node.getBoundingClientRect();
  node.classList.add('climb');
  setTimeout(() => node.classList.remove('climb'), 1100);
}

/** Keyed list update with FLIP: rows that move slide to their new place. */
function reconcile(list, items, keyOf, build, decorate, onMove) {
  const old = new Map();
  for (const child of list.children) old.set(child.dataset.id, { el: child, top: child.offsetTop, left: child.offsetLeft });
  const next = [];
  items.forEach((item, i) => {
    const key = String(keyOf(item));
    let node = old.get(key)?.el;
    const isNew = !node;
    if (!node || build.stale?.(node, item)) node = build(item);
    decorate(node, item, i, isNew);
    next.push(node);
  });
  const keep = new Set(next);
  for (const { el: child } of old.values()) if (!keep.has(child)) child.remove();
  next.forEach((node, i) => {
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
  });
  for (const node of next) {
    const prev = old.get(node.dataset.id);
    if (!prev || prev.el !== node) continue;
    const dy = prev.top - node.offsetTop;
    const dx = prev.left - node.offsetLeft;
    if (!dx && !dy) continue;
    node.style.transition = 'none';
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    node.getBoundingClientRect();
    node.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1)';
    node.style.transform = '';
    onMove?.(node, dx, dy);
  }
}

function renderBoard(st) {
  const r = st.round;
  const board = $('board');
  const rows = $('rows');
  const latest = $('latest');
  const empty = !r || r.guessCount === 0;
  board.classList.toggle('is-empty', empty);
  $('boardEmpty').innerHTML = !r ? esc(t('boardIdle')) : t('boardEmpty');
  if (empty) {
    rows.innerHTML = '';
    latest.innerHTML = '';
    S.latestId = null;
    $('more').textContent = '';
    return;
  }
  // pinned newest guess, like Contexto: you always see your own word land
  const latestKey = r.newest ? `${r.newest.id}:${safeFlag()}` : null;
  if (r.newest && S.latestId !== latestKey) {
    S.latestId = latestKey;
    latest.innerHTML = '';
    latest.appendChild(el('div', 'latest-label', esc(t('latest'))));
    const row = buildRow(r.newest);
    playIn(row);
    latest.appendChild(row);
  }
  const pinned = latest.querySelector('.row');
  if (pinned && r.newest) {
    const pos = r.board.findIndex((e) => e.id === r.newest.id) + 1;
    decorateRow(pinned, r.newest, r, 0.6);
    pinned.classList.remove('is-new');
  }

  const rowH = 56 + 6;
  const cap = Math.max(3, Math.floor((rows.clientHeight + 6) / rowH));
  const items = r.board.slice(0, cap);
  const build = (e) => buildRow(e);
  build.stale = (node) => node.dataset.safe !== safeFlag();
  let climbers = 0;
  reconcile(
    rows,
    items,
    (e) => e.id,
    build,
    (node, e, i, isNew) => {
      decorateRow(node, e, r, items.length > 1 ? 1 - i / (items.length - 1) : 1);
      if (isNew && e.id === r.newest?.id) playIn(node);
    },
    (node, dx, dy) => {
      if (dy > 8 && climbers < 4 && !node.classList.contains('flip-in')) {
        climbers++;
        climb(node);
      }
    },
  );
  const extra = r.guessCount - items.length;
  $('more').textContent = extra > 0 ? t('more', { n: fmtNum(extra) }) : '';
}

const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 1.5s.9 3.3-1.4 6.1C10.6 9.4 9 10.6 9 13a3 3 0 0 0 6 0c0-1 .4-1.9.4-1.9S18 12.8 18 16.2A6 6 0 0 1 6 16.2c0-5.7 7.5-8.3 7.5-14.7z"/></svg>';

function renderLeaders(st) {
  const top = Math.max(1, Number(S.settings.boardTop) || 5);
  const list = st.leaderboard.slice(0, top);
  $('leadersEmpty').hidden = list.length > 0;
  const build = (p) => {
    const u = shown(p);
    const li = el('li', 'leader');
    li.dataset.id = p.id;
    li.dataset.safe = safeFlag();
    li.appendChild(el('span', 'leader-rank'));
    li.appendChild(avatarEl(u));
    li.appendChild(el('span', 'leader-name', esc(u.name) + (p.sim ? '<span class="sim-tag">SIM</span>' : '')));
    li.appendChild(el('span', 'leader-streak-wrap'));
    li.appendChild(el('span', 'leader-pts'));
    return li;
  };
  build.stale = (node) => node.dataset.safe !== safeFlag();
  reconcile(
    $('leaders'),
    list,
    (p) => p.id,
    build,
    (li, p, i) => {
      li.querySelector('.leader-rank').textContent = String(i + 1);
      li.querySelector('.leader-pts').textContent = fmtNum(p.points);
      li.querySelector('.leader-streak-wrap').innerHTML = p.streak >= 2 ? `<span class="leader-streak">${FLAME}${p.streak}</span>` : '';
      li.classList.toggle('first', i === 0);
      const before = S.pointsSeen.get(p.id);
      if (before != null && before !== p.points) {
        li.classList.remove('bump');
        li.getBoundingClientRect();
        li.classList.add('bump');
      }
      S.pointsSeen.set(p.id, p.points);
    },
    (node, dx, dy) => dy > 8 && climb(node),
  );
}

function renderHistory(st) {
  const list = st.history || [];
  $('historyEmpty').hidden = list.length > 0;
  const html = list
    .slice(0, 6)
    .map((h) => {
      const miss = h.reason !== 'win';
      const who = miss ? esc(t(h.reason === 'skip' ? 'histSkip' : h.reason === 'timeout' ? 'histTimeout' : 'histReveal')) : `${esc(shown(h.winner).name)}<b>+${fmtNum(h.points)}</b>`;
      return `<li class="hist${miss ? ' is-miss' : ''}"><span class="hist-no">#${h.no}</span><span class="hist-word">${esc(h.word)}</span><span class="hist-who">${who}</span></li>`;
    })
    .join('');
  if ($('history').innerHTML !== html) $('history').innerHTML = html;
}

function renderHowto() {
  const s = Math.round((S.settings.cooldownMs ?? 2000) / 1000);
  const gift = esc(S.settings.hintGift || 'Rose');
  const cmds = ['!main', S.settings.freeHint !== false ? '!hint' : null, '!top', '!streak', '!ronde'].filter(Boolean).map((c) => `<kbd>${c}</kbd>`).join(' ');
  const items = [
    t('howGuess', { a: '<kbd>kata</kbd>', b: '<kbd>!kata</kbd>' }),
    t('howCooldown', { s }),
    t('howGift', { gift: `<b>${gift}</b>` }),
    t('howCmds', { cmds }),
  ];
  const html = items.map((x) => `<span class="howto-item">${x}</span>`).join('<span class="howto-sep"></span>');
  if ($('howto').innerHTML !== html) $('howto').innerHTML = html;
}

// ------------------------------------------------------------------ clock (timer, track, countdown, tension)
// Runs ten times a second, so it only touches the DOM when a value really changed.
const last = new Map();
function setText(id, v) {
  if (last.get(id) === v) return;
  last.set(id, v);
  $(id).textContent = v;
}
function setHtml(id, v) {
  if (last.get(id) === v) return;
  last.set(id, v);
  $(id).innerHTML = v;
}
const markMid = document.querySelector('.track-mark-mid');
const markEnd = document.querySelector('.track-mark-end');
function tickClock() {
  const st = S.state;
  if (!st) return;
  const zone = $('timerZone');
  const r = st.round;
  const hot = now() < S.hotUntil && !S.panic;
  if (hot !== S.hot) {
    S.hot = hot;
    document.body.classList.toggle('is-hot', hot);
  }
  if (st.phase === 'playing' && r) {
    const left = r.revealAt - now();
    const total = r.revealAt - r.startedAt;
    setText('timerLabel', t('timeLeft'));
    setText('timer', fmtTime(left));
    zone.classList.toggle('is-final', left <= 10000);
    zone.classList.toggle('is-late', left > 10000 && left <= 60000);
    zone.classList.remove('is-break');
    const p = Math.max(0, Math.min(1, 1 - left / total));
    const pct = (Math.round(p * 1000) / 10).toFixed(1);
    if (last.get('fill') !== pct) {
      last.set('fill', pct);
      $('trackFill').style.width = `${pct}%`;
      $('trackFill').style.backgroundPosition = `${pct}% 0`;
    }
    markMid.classList.toggle('done', !!r.firstLetterShown);
    markEnd.classList.remove('done');
    const sec = Math.ceil(left / 1000);
    if (sec <= 10 && sec >= 1 && sec !== S.lastCountdown) {
      S.lastCountdown = sec;
      sound.countdown(sec);
    }
    // the last 30 seconds: the timer thumps once a second, in time with the heartbeat sound
    if (sec <= 30 && sec >= 1 && sec !== S.lastBeat) {
      S.lastBeat = sec;
      const v = $('timer');
      v.classList.remove('beat');
      v.getBoundingClientRect();
      v.classList.add('beat');
    }
    sound.setTension(true, now() - r.startedAt, left);
  } else if (st.phase === 'break' && st.breakEndsAt) {
    const left = st.breakEndsAt - now();
    zone.classList.remove('is-late', 'is-final');
    zone.classList.add('is-break');
    setText('timerLabel', t('nextRound'));
    setText('timer', fmtTime(left));
    setHtml('breakNote', t('breakNote', { s: Math.max(0, Math.ceil(left / 1000)) }));
    sound.setTension(false);
  } else {
    zone.classList.remove('is-late', 'is-final', 'is-break');
    setText('timerLabel', t('waiting'));
    setText('timer', '–:––');
    sound.setTension(false);
  }
}
setInterval(() => timed(tickClock), 100);

// ------------------------------------------------------------------ popups
const BIG = new Set(['winner', 'reveal', 'gift', 'hint', 'instructions']);
let shownId = null;
let shownEls = [];

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  bang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v10"/><path d="M12 19.5v.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M12 8S9 7.5 8 6a2 2 0 1 1 4-1zM12 8s3-.5 4-2a2 2 0 1 0-4-1z"/></svg>',
};

function wordSlots(word, how, base = 120) {
  const chars = [...word];
  const w = Math.max(44, Math.min(70, Math.floor(700 / chars.length) - 10));
  return `<div class="card-word">${chars.map((ch, i) => `<div class="slot open ${how} flip" style="--w:${w}px;--d:${base + i * 70}ms">${esc(ch)}</div>`).join('')}</div>`;
}

/** Meaning (KBBI), guess counts, the closest runner-up and the first hint: shown under the answer. */
function recapHtml(rc) {
  if (!rc) return '';
  const facts = [];
  facts.push(t('recapStats', { n: fmtNum(rc.guessCount), p: fmtNum(rc.players) }));
  if (rc.runnerUp) facts.push(t('recapRunner', { word: `<b>${esc(rc.runnerUp.word)}</b>`, name: esc(shown(rc.runnerUp.user).name) }));
  const fh = rc.firstHint;
  if (fh) {
    const L = `<b>${esc(fh.letter.toUpperCase())}</b>`;
    facts.push(fh.how === 'gift' ? t('recapFirstGift', { letter: L, name: esc(shown(fh.user).name) }) : fh.how === 'free' ? t('recapFirstFree', { letter: L, name: esc(shown(fh.user).name) }) : t('recapFirstAuto', { letter: L }));
  }
  return `<div class="recap">${rc.meaning ? `<p class="recap-meaning"><span>${esc(t('recapMeaning'))}</span>${esc(rc.meaning)}</p>` : ''}<ul class="recap-facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul></div>`;
}

function miniShell(type, extra = '') {
  return el('div', `mini mini-${type}${extra ? ` ${extra}` : ''}`);
}

function buildCmd(d) {
  const who = shown(d.user);
  const mini = miniShell('cmd', `mini-cmd-${d.cmd}`);
  if (d.cmd === 'top') {
    const rows = d.leaders.length
      ? d.leaders.map((p, i) => `<div class="mini-list-row"><span><b>${i + 1}.</b> ${esc(shown(p).name)}</span><span>${fmtNum(p.points)}</span></div>`).join('')
      : `<div class="mini-sub">${esc(t('cmdTopEmpty'))}</div>`;
    mini.innerHTML = `<div class="mini-body"><div class="mini-title">${esc(t('cmdTopTitle'))}</div><div class="mini-list">${rows}</div></div>`;
    return mini;
  }
  if (d.cmd === 'streak') {
    mini.appendChild(avatarEl(who));
    const body = el('div', 'mini-body');
    body.innerHTML = `<div class="mini-title">${esc(d.streak >= 1 ? t('cmdStreakTitle', { name: who.name, n: d.streak }) : t('cmdStreakNone', { name: who.name }))}</div><div class="mini-sub">${esc(t('cmdStreakSub', { w: d.wins, pts: fmtNum(d.points) }))}</div>`;
    mini.appendChild(body);
    if (d.streak >= 2) mini.appendChild(el('span', 'mini-badge', FLAME.replace('<svg', '<svg width="22" height="22"')));
    return mini;
  }
  mini.appendChild(el('span', 'mini-icon', d.cmd === 'ronde' ? ICONS.clock : ICONS.bang));
  const body = el('div', 'mini-body');
  if (d.cmd === 'ronde') {
    const left = d.endsAt != null ? fmtTime(d.endsAt - now()) : '';
    const title = d.phase === 'playing' ? t('cmdRondePlay', { n: d.no, t: left }) : d.phase === 'break' ? t('cmdRondeBreak', { t: left }) : t('cmdRondeIdle');
    body.innerHTML = `<div class="mini-title">${esc(title)}</div><div class="mini-sub">${esc(t('cmdRondeSub', { name: who.name }))}</div>`;
  } else if (d.cmd === 'hint-wait') {
    body.innerHTML = `<div class="mini-title">${esc(t('cmdHintWait', { s: Math.max(1, Math.ceil((d.endsAt - now()) / 1000)) }))}</div><div class="mini-sub">${esc(t('cmdHintWaitSub'))}</div>`;
  } else {
    body.innerHTML = `<div class="mini-title">${esc(t('cmdHintUsed'))}</div><div class="mini-sub">${esc(t('cmdHintUsedSub'))}</div>`;
  }
  mini.appendChild(body);
  return mini;
}

function buildPopup(p) {
  const d = p.data;
  if (p.type === 'instructions') {
    const s = Math.round((S.settings.cooldownMs ?? 2000) / 1000);
    const card = el('div', 'card card-instructions');
    card.innerHTML = `
      <p class="card-kicker">${esc(t('roundSub', { len: t('letters', { n: d.length }), cls: classLabel(d.wordClass) }))}</p>
      <h3 class="card-title">${esc(t('roundStart', { n: d.no }))}</h3>
      <div class="rules">
        <div class="rule"><div class="rule-icon">${ICONS.chat}</div><div class="rule-title">${esc(t('ruleGuessT'))}</div><div class="rule-text">${esc(t('ruleGuessXv'))}</div></div>
        <div class="rule"><div class="rule-icon">${ICONS.bang}</div><div class="rule-title">${t('rulePrefixT', { cmd: '<kbd>!kata</kbd>' })}</div><div class="rule-text">${t('rulePrefixX', { ex: '<kbd>!rumah</kbd>' })}</div></div>
        <div class="rule"><div class="rule-icon">${ICONS.clock}</div><div class="rule-title">${esc(t('ruleCooldownT', { s }))}</div><div class="rule-text">${esc(t('ruleCooldownX', { s }))}</div></div>
      </div>`;
    return card;
  }
  if (p.type === 'winner') {
    const card = el('div', 'card card-winner');
    const pts = d.points;
    const row = (label, v, cls = '') => `<dt class="${cls}">${esc(t(label))}</dt><dd class="${cls}${v ? '' : ' zero'}">${v ? `+${fmtNum(v)}` : '0'}</dd>`;
    card.innerHTML = `
      <p class="card-kicker">${esc(t('winKicker', { n: d.no, t: fmtTime(d.elapsedMs) }))}</p>
      <h3 class="card-title">${esc(t('winTitle'))}</h3>
      <div class="winner-who"></div>
      ${wordSlots(d.word, 'by-win')}
      ${recapHtml(d.recap)}
      <dl class="breakdown">
        ${row('base', pts.base)}${row('speed', pts.speed)}${row('streak', pts.streak)}
        <dt class="total">${esc(t('total'))}</dt><dd class="total">${fmtNum(pts.total)}</dd>
      </dl>
      ${d.helpers?.length ? `<div class="helpers"><span class="helpers-label">${esc(t('helpersLabel'))}</span>${d.helpers.slice(0, 6).map((h) => `<span class="helper-chip">${esc(shown(h.user).name)} · #${h.rank} · +${h.points}</span>`).join('')}</div>` : ''}`;
    const who = card.querySelector('.winner-who');
    who.appendChild(avatarEl(shown(d.winner)));
    who.appendChild(el('span', 'winner-name', esc(shown(d.winner).name)));
    if (d.streak >= 5) card.classList.add('is-epic');
    return card;
  }
  if (p.type === 'reveal') {
    const card = el('div', 'card card-reveal');
    card.innerHTML = `
      <h3 class="card-title">${esc(t(d.reason === 'timeout' ? 'revealTitle' : 'revealSkip'))}</h3>
      ${wordSlots(d.word, 'by-end', 1000)}
      ${recapHtml(d.recap)}
      <p class="card-sub">${esc(t('revealSub'))}</p>`;
    return card;
  }
  if (p.type === 'hint') {
    const card = el('div', `card card-hint${d.kind === 'free' ? ' card-free' : ''}`);
    if (d.kind === 'free') {
      card.innerHTML = `
        <p class="card-kicker">${esc(t('hintFreeKicker'))}</p>
        <h3 class="card-title">${esc(t('hintFreeTitle', { name: shown(d.user).name }))}</h3>
        <div class="hint-letter"><div class="slot open by-free flip">${esc(d.letter)}</div></div>
        <p class="card-sub">${esc(t('hintFreeSub', { pos: d.index + 1 }))}</p>`;
      return card;
    }
    card.innerHTML = `
      <p class="card-kicker">${esc(t('hintKicker'))}</p>
      <h3 class="card-title">${esc(t('hintTitle'))}</h3>
      <div class="hint-letter"><div class="slot open by-first flip">${esc(d.letter)}</div></div>
      <p class="card-sub">${esc(t('hintSub'))}</p>`;
    return card;
  }
  if (p.type === 'gift') {
    const card = el('div', 'card card-gift');
    card.innerHTML = `
      <p class="card-kicker">${esc(t('giftKicker', { gift: d.gift }))}</p>
      <h3 class="card-title">${esc(t('giftTitle', { name: shown(d.user).name }))}</h3>
      <div class="hint-letter"><div class="slot open by-gift flip">${esc(d.letter)}</div></div>
      <p class="card-sub">${esc(t('giftSub', { pos: d.index + 1, used: d.used, max: d.max }))}</p>`;
    return card;
  }
  // compact cards
  if (p.type === 'cmd') return buildCmd(d);
  const mini = miniShell(p.type);
  if (p.type === 'helper') {
    mini.innerHTML = `<div class="mini-body"><div class="mini-title">${esc(t('helperTitle'))}</div><div class="mini-list">${d.helpers
      .slice(0, 4)
      .map((h) => `<div class="mini-list-row"><span><b>${esc(shown(h.user).name)}</b> #${h.rank}</span><span>+${h.points}</span></div>`)
      .join('')}</div></div>`;
    return mini;
  }
  if (p.type === 'hot') {
    mini.appendChild(el('span', 'mini-icon mini-icon-hot', FLAME));
    const body = el('div', 'mini-body');
    body.innerHTML = `<div class="mini-title">${esc(t('hotTitle'))}</div><div class="mini-sub">${esc(t('hotLine', { n: d.count, s: Math.round(d.windowMs / 1000) }))}</div>`;
    mini.appendChild(body);
    return mini;
  }
  const u = shown(d.user ?? d.entry?.user);
  mini.appendChild(avatarEl(u));
  const body = el('div', 'mini-body');
  if (p.type === 'follow') body.innerHTML = `<div class="mini-title">${esc(t('followTitle', { name: u.name }))}</div><div class="mini-sub">${esc(t('followSub'))}</div>`;
  if (p.type === 'join') body.innerHTML = `<div class="mini-title">${esc(t('joinTitle', { name: u.name }))}</div><div class="mini-sub">${esc(d.streak >= 1 ? t('joinStreak', { n: d.streak }) : t('joinSub', { pts: fmtNum(d.points) }))}</div>`;
  if (p.type === 'streak') body.innerHTML = `<div class="mini-title">${esc(t('streakTitle', { name: u.name, n: d.count }))}</div><div class="mini-sub">${esc(t('streakSub', { b: d.bonus }))}</div>`;
  if (p.type === 'close') {
    const e = d.entry;
    const sub = t('closeSubRank', { word: e.word, rank: e.rank });
    body.innerHTML = `<div class="mini-title">${esc(t('closeTitle', { name: u.name }))}</div><div class="mini-sub">${esc(sub)}</div>`;
    mini.appendChild(body);
    mini.appendChild(el('span', 'mini-icon mini-icon-close', ICONS.target));
    return mini;
  }
  if (p.type === 'thanks') {
    const title = d.count > 1 ? t('thanksTitleN', { name: u.name, gift: d.gift || '🎁', n: d.count }) : t('thanksTitle', { name: u.name, gift: d.gift || '🎁' });
    body.innerHTML = `<div class="mini-title">${esc(title)}</div><div class="mini-sub">${esc(t('thanksSub'))}</div>`;
    mini.appendChild(body);
    mini.appendChild(el('span', 'mini-icon mini-icon-gift', ICONS.gift));
    return mini;
  }
  mini.appendChild(body);
  if (p.type === 'streak') mini.appendChild(el('span', 'mini-badge', `${FLAME.replace('<svg', '<svg width="22" height="22"')}`));
  return mini;
}

function clearPopups() {
  popups.drop();
  shownEls.forEach((e) => e.remove());
  shownEls = [];
  shownId = null;
}

function tickPopups() {
  const { current, phase } = popups.tick(Date.now());
  if (!current) {
    if (shownId != null) {
      shownEls.forEach((e) => e.remove());
      shownEls = [];
      shownId = null;
    }
    return;
  }
  if (current.id !== shownId) {
    shownEls.forEach((e) => e.remove());
    shownEls = [];
    shownId = current.id;
    const node = buildPopup(current);
    if (BIG.has(current.type)) {
      if (current.type === 'winner' || current.type === 'reveal') {
        const scrim = el('div', 'scrim');
        $('popupLayer').appendChild(scrim);
        shownEls.push(scrim);
      }
      $('popupLayer').appendChild(node);
    } else if (S.layout === 'portrait') $('popupLayer').appendChild(node);
    else $('dock').appendChild(node);
    shownEls.push(node);
  }
  if (phase === 'out') shownEls.forEach((e) => e.classList.add('out'));
}
setInterval(() => timed(tickPopups), 100);

function toast(entry) {
  const layer = $('toastLayer');
  layer.innerHTML = '';
  const u = shown(entry.user);
  const n = el('div', 'toast');
  n.appendChild(avatarEl(u));
  n.insertAdjacentHTML('beforeend', `<span>${esc(t('firstGuess'))}: <b>${esc(u.name)}</b> · <span class="toast-word">${esc(entry.word)}</span></span>`);
  n.addEventListener('animationend', () => n.remove());
  layer.appendChild(n);
}

let speakGen = 0;
function speak(text) {
  if (!S.settings.tts || S.panic || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = getLang() === 'en' ? 'en-US' : 'id-ID';
    const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1;
    // the music ducks about 10 dB while the voice speaks, and comes back over 400 ms
    const gen = ++speakGen;
    const done = () => gen === speakGen && sound.duckEnd();
    u.onstart = () => sound.duckStart();
    u.onend = done;
    u.onerror = done;
    setTimeout(done, 12000); // a voice that never reports back must not leave the music down
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* speech is optional */
  }
}

// ------------------------------------------------------------------ events
function onEvt(evt) {
  if (S.panic) return; // nothing plays while the stream is paused
  const at = Date.now();
  switch (evt.type) {
    case 'round':
      popups.drop('instructions');
      popups.drop('hot');
      popups.push('instructions', evt, at);
      S.lastCountdown = null;
      S.lastBeat = null;
      S.bestHeat = 0;
      S.heatSent = -1;
      S.hotUntil = 0;
      sound.roundStart();
      break;
    case 'guess': {
      const e = evt.entry;
      if (evt.first) toast(e);
      S.pulse = Math.min(1, S.pulse + 0.12);
      if (evt.win) break; // the fanfare follows
      const v = e.outOfRange ? 0 : e.closeness ?? 0;
      sound.tick(v);
      if (v >= 0.67) sound.hot();
      else if (v < 0.2) sound.cold();
      // a new closest guess gets a soft chord
      if (!e.outOfRange && v > S.bestHeat + 0.03) {
        S.bestHeat = v;
        sound.best(v);
      }
      break;
    }
    case 'hint':
      if (evt.kind === 'gift') {
        popups.push('gift', evt, at);
        sound.giftBell();
        sound.flipWord(1, { delay: 0.05, peak: 0.08 });
      } else {
        popups.push('hint', evt, at);
        sound.bell();
        sound.flipWord(1, { delay: 0.05, peak: 0.08 });
      }
      S.pulse = Math.min(1, S.pulse + 0.3);
      break;
    case 'win':
      popups.push('winner', evt, at);
      sound.fanfare(evt.streak);
      sound.flipWord([...evt.word].length, { delay: 0.14, spacing: 0.07, peak: 0.04 });
      S.pulse = 1;
      setTimeout(() => burst(evt.streak >= 5 ? 320 : 180), 250);
      if (evt.streak >= 5) setTimeout(() => burst(160), 750);
      speak(t('ttsWin', { name: spokenName(evt.winner), word: evt.word }));
      break;
    case 'reveal':
      popups.push('reveal', evt, at);
      sound.revealFall();
      sound.flipWord([...evt.word].length, { delay: 1.02, spacing: 0.07, peak: 0.05 });
      break;
    case 'break':
      // one slow rise across the whole break, landing on the next round's start chime
      setTimeout(() => sound.breakSweep((evt.endsAt - now()) / 1000 - 1.2), 1000);
      break;
    case 'close':
      popups.push('close', evt, at);
      sound.close();
      S.pulse = Math.min(1, S.pulse + 0.4);
      break;
    case 'hot':
      S.hotUntil = evt.until;
      popups.push('hot', evt, at);
      sound.hotstreak();
      S.pulse = Math.min(1, S.pulse + 0.5);
      break;
    case 'cmd':
      popups.push('cmd', evt, at);
      sound.command();
      break;
    case 'gift':
      popups.push('thanks', evt, at);
      sound.giftChime(evt.gift, evt.count);
      S.pulse = Math.min(1, S.pulse + 0.2);
      break;
    case 'join':
      popups.push('join', evt, at); // silent by design
      break;
    case 'follow':
      popups.push('follow', evt, at);
      break;
    case 'like':
      hearts.burst(evt.count);
      break;
    case 'helpers':
      popups.push('helper', evt, at);
      break;
    case 'streak':
      popups.push('streak', evt, at);
      break;
    default:
  }
}

function onState(msg) {
  S.offset = msg.state.serverNow - Date.now();
  const prevLang = getLang();
  S.settings = { ...S.settings, ...msg.settings };
  S.state = msg.state;
  if (setLang(S.settings.lang) || prevLang !== getLang()) applyStatic();
  document.body.classList.toggle('no-flash', !!S.settings.reduceFlash || urlNoFlash);

  // panic: everything stops, the cover hides the stage, and no popup or sound survives it
  const panic = !!msg.state.panic;
  if (panic !== S.panic) {
    S.panic = panic;
    document.body.classList.toggle('is-panic', panic);
    if (panic) {
      clearPopups();
      S.hotUntil = 0;
      try {
        speechSynthesis.cancel();
      } catch {
        /* no speech */
      }
      sound.duckEnd();
    }
  }
  sound.setMuted(S.settings.mutedFx);
  sound.setVolumes({ music: S.settings.musicVol, sfx: S.settings.sfxVol, sound: S.settings.sound && !panic });
  if (S.phase !== msg.state.phase) {
    S.phase = msg.state.phase;
    sound.setScene(S.phase === 'playing' ? 'playing' : S.phase === 'break' ? 'break' : 'idle', msg.state.breakEndsAt ? msg.state.breakEndsAt - now() : 15000);
  }
  if (S.layout == null || (urlLayout == null && S.settings.layout !== S.layout)) applyLayout();
  else timed(render, 'render');
}

let connTimer = null;
const net = new Net({
  role: 'overlay',
  onState,
  onEvt,
  onOpen: () => {
    clearTimeout(connTimer);
    $('conn').hidden = true;
    net.send({ t: 'audio', state: sound.state });
  },
  onClose: () => {
    clearTimeout(connTimer);
    connTimer = setTimeout(() => {
      $('conn').textContent = t('reconnecting');
      $('conn').hidden = false;
    }, 2000);
  },
});

sound.onState((s) => net.send({ t: 'audio', state: s }));

// ------------------------------------------------------------------ audio-reactive glow
// A calm radial glow behind the stage follows the loudness of the mix (and the events, when
// there is no sound). Only its opacity changes, so it costs next to nothing per frame.
const auraPulse = $('auraPulse');
let lastLevelAt = 0;
function levelLoop(ts) {
  requestAnimationFrame(levelLoop);
  if (ts - lastLevelAt < 33) return;
  lastLevelAt = ts;
  timed(() => {
    S.pulse *= 0.9;
    const lvl = Math.max(sound.level(), S.pulse);
    auraPulse.style.opacity = (noFlash() ? Math.min(lvl, 0.35) * 0.5 : Math.min(1, lvl * 1.1)).toFixed(3);
  });
}
requestAnimationFrame(levelLoop);

// ------------------------------------------------------------------ benchmark HUD
function startBench() {
  const hud = el('pre', 'bench');
  Object.assign(hud.style, { position: 'fixed', right: '8px', top: '8px', zIndex: 200, margin: 0, padding: '8px 10px', borderRadius: '8px', background: 'rgba(0,0,0,.78)', color: '#9fffc8', font: '13px/1.35 ui-monospace,Consolas,monospace', pointerEvents: 'none' });
  document.body.appendChild(hud);
  let last = performance.now();
  const frame = (ts) => {
    bench.frames.push(ts - last);
    bench.work_ms.push(bench.work);
    bench.work = 0;
    last = ts;
    if (bench.frames.length > 600) {
      bench.frames.shift();
      bench.work_ms.shift();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const pct = (a, p) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  // Script time per second of wall clock, divided by 60: what the overlay costs per frame at 60 fps,
  // however slowly this machine actually draws.
  const perFrame60 = () => {
    const t1 = performance.now();
    while (bench.calls.length && t1 - bench.calls[0][0] > 10000) bench.calls.shift();
    if (!bench.calls.length) return 0;
    const span = Math.max(1000, t1 - bench.calls[0][0]);
    return (bench.calls.reduce((a, c) => a + c[1], 0) / span) * (1000 / 60);
  };
  const callMs = () => bench.calls.map((c) => c[1]);
  const stats = () => ({
    scriptMsPerFrame60: +perFrame60().toFixed(2),
    callMsP95: +pct(callMs(), 95).toFixed(2),
    callMsMax: +Math.max(0, ...callMs()).toFixed(2),
    frames: bench.frames.length,
    fps: bench.frames.length ? Math.round(1000 / (bench.frames.reduce((a, b) => a + b, 0) / bench.frames.length)) : 0,
    frameMsP95: +pct(bench.frames, 95).toFixed(1),
    workMsP50: +pct(bench.work_ms, 50).toFixed(2),
    workMsP95: +pct(bench.work_ms, 95).toFixed(2),
    workMsMax: +Math.max(0, ...bench.work_ms).toFixed(2),
    renderMsP95: +pct(bench.render, 95).toFixed(2),
    renderMsMax: +Math.max(0, ...bench.render).toFixed(2),
  });
  window.__bench = stats;
  setInterval(() => {
    const s = stats();
    hud.textContent = `fps ${s.fps}  frame p95 ${s.frameMsP95} ms\nscript per frame @60fps ${s.scriptMsPerFrame60} ms (goal < 5)\nslowest call p95 ${s.callMsP95}  max ${s.callMsMax} ms\nrender() p95 ${s.renderMsP95}  max ${s.renderMsMax} ms`;
  }, 1000);
}
if (bench) startBench();

applyStatic();
applyLayout();
renderHowto();

// handy for checking popups without a live chat: ?demo=popups
if (q.get('demo') === 'popups') {
  window.__evt = onEvt;
  window.__S = S;
}
