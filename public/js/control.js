// Streamer control page. Shows the answer, so it must never be added to OBS.
import { Net } from './net.js';
import { Sound, EFFECTS, FX_GROUPS } from './audio.js';

const q = new URLSearchParams(location.search);
const KEY = q.get('key') || '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const T = {
  id: {
    controlTitle: 'Kontrol streamer', clickForSound: 'Klik untuk suara',
    warnObs: 'Halaman ini menampilkan jawaban. Jangan tambahkan ke OBS dan jangan bagikan layarnya.',
    round: 'Ronde', answer: 'Jawaban', hide: 'Sembunyikan', show: 'Tampilkan', timer: 'Waktu', guesses: 'Tebakan', giftHints: 'Hint gift', closest: 'Terdekat',
    start: 'Mulai ronde', skip: 'Lewati kata', reveal: 'Buka jawaban', nextWord: 'Kata berikutnya', nextWordPh: 'acak dari daftar', set: 'Atur', random: 'Acak',
    controls: 'Kendali', simulator: 'Simulator', simNote: 'Penonton palsu untuk mencoba. Mati otomatis saat LIVE.', simLive: 'Tidak bisa dinyalakan saat LIVE tersambung.',
    overlaySound: 'Suara overlay', overlaySoundNote: 'Musik dan efek di OBS.', layout: 'Tata letak', landscape: 'Lanskap', portrait: 'Potret',
    mode: 'Mode', modeLetters: 'Huruf', modeVector: 'Makna', modeNoVectors: 'Mode makna butuh VECTORS_PATH.', modeVectorsOk: 'Vektor kata dimuat.',
    boardTop: 'Papan skor overlay', resetSession: 'Reset sesi', clearBoard: 'Bersihkan papan skor',
    resetHint: 'Reset sesi menghapus poin dan rentetan menang sesi ini. Bersihkan papan skor hanya menghapus poin.',
    settings: 'Pengaturan', hintGift: 'Gift petunjuk', hintGiftNote: 'Nama gift yang membuka 1 huruf.', cooldown: 'Jeda tebakan', cooldownNote: 'Detik antar tebakan per penonton.',
    tts: 'Baca nama pemenang', ttsNote: 'Suara browser membacakan pemenang dan katanya.', language: 'Bahasa', darkMode: 'Mode gelap',
    sound: 'Suara', music: 'Musik', effects: 'Efek', listen: 'Dengar', stop: 'Berhenti', previewHint: 'Pratinjau diputar di halaman ini, bukan di stream.',
    sessionBoard: 'Papan skor sesi', noPoints: 'Belum ada poin di sesi ini.', allTime: 'Sepanjang masa',
    noAllTime: 'Belum ada skor tersimpan. Pemain simulator tidak pernah masuk ke sini.', exportCsv: 'Ekspor CSV', resetAll: 'Reset sepanjang masa',
    confirmText: 'Semua skor sepanjang masa akan dihapus. Ketik HAPUS untuk lanjut.', confirmReset: 'Hapus semua', cancel: 'Batal',
    activity: 'Aktivitas', obsLinks: 'Link OBS', obsHint: 'Tambahkan sebagai Browser Source. Centang "Control audio via OBS".', copy: 'Salin', copied: 'Disalin',
    landscapeLink: 'Lanskap 1920x1080', portraitLink: 'Potret 1080x1920',
    idle: 'Belum mulai', playing: 'Berjalan', break: 'Jeda', noRound: 'Belum ada ronde', roundN: 'Ronde {n}',
    letters: '{n} huruf', unknownClass: 'jenis kata tidak diketahui', revealed: 'terbuka: {x}',
    liveOn: 'LIVE @{u}', liveOff: 'LIVE mati', liveNoKey: 'LIVE: belum ada STREAMCHIME_APP_KEY', liveConnecting: 'LIVE: menyambung…', simOn: 'Simulator menyala',
    overlays: '{n} overlay', noOverlay: 'Overlay belum terbuka', audioRunning: 'Audio overlay jalan', audioBlocked: 'Audio overlay diblokir: klik overlay sekali (Interact di OBS)', audioOff: 'Audio overlay mati',
    nextSet: 'Kata berikutnya: {w}', nextRandom: 'Kata berikutnya dipilih acak.', notInKbbi: 'Kata itu tidak ada di KBBI.',
    played: 'Terkirim', alreadyPlaying: 'Ronde sedang berjalan.', simBlocked: 'Simulator tidak bisa jalan saat LIVE.', wins: '{n} menang', count: '{n} pemain', saved: 'Tersimpan',
    effect_tickCold: 'Tebakan dingin', effect_tickHot: 'Tebakan hangat', effect_hot: 'Chime panas', effect_cold: 'Dentum dingin', effect_flip: 'Ubin membalik', effect_best: 'Terdekat baru', effect_close: 'Hampir benar', effect_hotstreak: 'Tebakan beruntun',
    effect_giftHint: 'Gift buka huruf', effect_giftChime: 'Terima kasih gift', effect_bell: 'Lonceng huruf', effect_fanfare1: 'Menang', effect_fanfare3: 'Menang beruntun 3', effect_fanfare5: 'Menang beruntun 5',
    effect_countdown: 'Hitung mundur', effect_heartbeat: 'Detak akhir', effect_tension: 'Ketegangan menit akhir', effect_revealFall: 'Jawaban dibuka', effect_breakSweep: 'Sapuan jeda', effect_roundStart: 'Ronde mulai', effect_command: 'Perintah chat',
    panicIdle: 'Tombol panik', panicNote: 'Hentikan suara, bekukan ronde, dan sembunyikan jawaban di semua layar.', panicOn: 'PANIK', panicActive: 'Panik aktif', panicActiveNote: 'Ronde dibekukan. Jawaban disembunyikan di overlay dan di halaman ini. Waktu berhenti.', panicOff: 'Lanjutkan', panicBlocked: 'Panik aktif. Lanjutkan dulu.',
    difficulty: 'Tingkat kesulitan', diffEasy: 'Mudah', diffNormal: 'Normal', diffHard: 'Sulit', diffNote: '{easy} mudah · {normal} normal · {hard} sulit. Berlaku ronde berikutnya.',
    freeHint: 'Petunjuk gratis !hint', freeHintNote: 'Satu huruf gratis per ronde, bersama untuk semua penonton.',
    streamerWins: 'Tebakan benar streamer dihitung', streamerWinsNote: 'Mati: tebakan akunmu sendiri tidak menang dan tidak memberi poin.',
    sceneSafe: 'Mode aman layar', sceneSafeNote: 'Nama dan foto penonton diganti kode di overlay.',
    reduceFlash: 'Kurangi kilatan', reduceFlashNote: 'Tanpa kedip, getar, dan konfeti padat. Terpisah dari pengurangan gerak.',
    muteTitle: 'Matikan per suara', muteHint: 'Tiap suara bisa dimatikan sendiri tanpa mengubah yang lain. Setiap suara punya tanda visual di overlay.',
    mute_roundStart: 'Ronde mulai', mute_tick: 'Tebakan', mute_cold: 'Dentum dingin', mute_hot: 'Chime panas', mute_flip: 'Ubin membalik', mute_best: 'Terdekat baru', mute_close: 'Hampir benar', mute_hotstreak: 'Tebakan beruntun', mute_command: 'Perintah chat',
    mute_gift: 'Gift', mute_bell: 'Lonceng huruf', mute_countdown: 'Hitung mundur', mute_heartbeat: 'Detak dan ketegangan', mute_fanfare: 'Fanfare menang', mute_reveal: 'Jawaban dibuka', mute_breakSweep: 'Sapuan jeda',
    health: 'Kesehatan', hTikTok: 'TikTok', hReconnect: 'Sambung ulang', hLastEvent: 'Event terakhir', hCpu: 'CPU', hMem: 'Memori', hLag: 'Jeda event loop', hOverlays: 'Overlay terbuka', hControls: 'Halaman kontrol', hRate: 'Event per menit', hLog: 'Log event',
    hNever: 'belum ada', hAgo: '{s} dtk lalu', hLogOn: 'ditulis ke data/logs', hLogOff: 'mati', hOk: 'normal', hSlow: 'lambat',
  },
  en: {
    controlTitle: 'Streamer controls', clickForSound: 'Click for sound',
    warnObs: 'This page shows the answer. Never add it to OBS or share this screen.',
    round: 'Round', answer: 'Answer', hide: 'Hide', show: 'Show', timer: 'Time', guesses: 'Guesses', giftHints: 'Gift hints', closest: 'Closest',
    start: 'Start round', skip: 'Skip word', reveal: 'Reveal word', nextWord: 'Next word', nextWordPh: 'random from the list', set: 'Set', random: 'Random',
    controls: 'Controls', simulator: 'Simulator', simNote: 'Fake viewers for testing. Turns off by itself when LIVE.', simLive: 'Cannot run while LIVE is connected.',
    overlaySound: 'Overlay sound', overlaySoundNote: 'Music and effects in OBS.', layout: 'Layout', landscape: 'Landscape', portrait: 'Portrait',
    mode: 'Mode', modeLetters: 'Letters', modeVector: 'Meaning', modeNoVectors: 'Meaning mode needs VECTORS_PATH.', modeVectorsOk: 'Word vectors loaded.',
    boardTop: 'Overlay scoreboard', resetSession: 'Reset session', clearBoard: 'Clear scoreboard',
    resetHint: 'Reset session clears this session’s points and win streak. Clear scoreboard clears points only.',
    settings: 'Settings', hintGift: 'Hint gift', hintGiftNote: 'Gift name that opens 1 letter.', cooldown: 'Guess cooldown', cooldownNote: 'Seconds between guesses per viewer.',
    tts: 'Read the winner aloud', ttsNote: 'The browser voice reads the winner and the word.', language: 'Language', darkMode: 'Dark mode',
    sound: 'Sound', music: 'Music', effects: 'Effects', listen: 'Listen', stop: 'Stop', previewHint: 'Previews play on this page, not on the stream.',
    sessionBoard: 'Session scoreboard', noPoints: 'No points this session yet.', allTime: 'All time',
    noAllTime: 'No saved scores yet. Simulator players never appear here.', exportCsv: 'Export CSV', resetAll: 'Reset all-time board',
    confirmText: 'Every all-time score will be deleted. Type HAPUS to continue.', confirmReset: 'Delete all', cancel: 'Cancel',
    activity: 'Activity', obsLinks: 'OBS links', obsHint: 'Add as a Browser Source. Tick "Control audio via OBS".', copy: 'Copy', copied: 'Copied',
    landscapeLink: 'Landscape 1920x1080', portraitLink: 'Portrait 1080x1920',
    idle: 'Not started', playing: 'Playing', break: 'Break', noRound: 'No round yet', roundN: 'Round {n}',
    letters: '{n} letters', unknownClass: 'word class unknown', revealed: 'open: {x}',
    liveOn: 'LIVE @{u}', liveOff: 'LIVE off', liveNoKey: 'LIVE: no STREAMCHIME_APP_KEY yet', liveConnecting: 'LIVE: connecting…', simOn: 'Simulator on',
    overlays: '{n} overlay(s)', noOverlay: 'No overlay open', audioRunning: 'Overlay audio running', audioBlocked: 'Overlay audio blocked: click the overlay once (Interact in OBS)', audioOff: 'Overlay audio off',
    nextSet: 'Next word: {w}', nextRandom: 'The next word is random.', notInKbbi: 'That word is not in KBBI.',
    played: 'Sent', alreadyPlaying: 'A round is already running.', simBlocked: 'The simulator cannot run while LIVE.', wins: '{n} wins', count: '{n} players', saved: 'Saved',
    effect_tickCold: 'Cold guess', effect_tickHot: 'Warm guess', effect_hot: 'Hot chime', effect_cold: 'Cold thud', effect_flip: 'Tiles flipping', effect_best: 'New closest', effect_close: 'Close call', effect_hotstreak: 'Hot streak',
    effect_giftHint: 'Gift opens a letter', effect_giftChime: 'Gift thank-you', effect_bell: 'Letter bell', effect_fanfare1: 'Win', effect_fanfare3: 'Win streak 3', effect_fanfare5: 'Win streak 5',
    effect_countdown: 'Countdown', effect_heartbeat: 'Final heartbeat', effect_tension: 'Last-minute tension', effect_revealFall: 'Reveal', effect_breakSweep: 'Break sweep', effect_roundStart: 'Round start', effect_command: 'Chat command',
    panicIdle: 'Panic button', panicNote: 'Stops sound, freezes the round and hides the answer on every screen.', panicOn: 'PANIC', panicActive: 'Panic is on', panicActiveNote: 'The round is frozen. The answer is hidden on the overlay and on this page. The clock is stopped.', panicOff: 'Resume', panicBlocked: 'Panic is on. Resume first.',
    difficulty: 'Difficulty', diffEasy: 'Easy', diffNormal: 'Normal', diffHard: 'Hard', diffNote: '{easy} easy · {normal} normal · {hard} hard. Applies from the next round.',
    freeHint: 'Free !hint', freeHintNote: 'One free letter per round, shared by all viewers.',
    streamerWins: 'Streamer’s own win counts', streamerWinsNote: 'Off: a correct guess from your own account does not win or score.',
    sceneSafe: 'Scene-safe mode', sceneSafeNote: 'Viewer names and photos become short codes on the overlay.',
    reduceFlash: 'Reduce flashing', reduceFlashNote: 'No blinking, shaking or dense confetti. Separate from reduced motion.',
    muteTitle: 'Mute per sound', muteHint: 'Each sound can be muted on its own. Every sound has a visual cue on the overlay.',
    mute_roundStart: 'Round start', mute_tick: 'Guess tick', mute_cold: 'Cold thud', mute_hot: 'Hot chime', mute_flip: 'Tiles flipping', mute_best: 'New closest', mute_close: 'Close call', mute_hotstreak: 'Hot streak', mute_command: 'Chat command',
    mute_gift: 'Gifts', mute_bell: 'Letter bell', mute_countdown: 'Countdown', mute_heartbeat: 'Heartbeat and tension', mute_fanfare: 'Win fanfare', mute_reveal: 'Reveal', mute_breakSweep: 'Break sweep',
    health: 'Health', hTikTok: 'TikTok', hReconnect: 'Reconnects', hLastEvent: 'Last event', hCpu: 'CPU', hMem: 'Memory', hLag: 'Event-loop lag', hOverlays: 'Overlays open', hControls: 'Control pages', hRate: 'Events per minute', hLog: 'Event log',
    hNever: 'none yet', hAgo: '{s}s ago', hLogOn: 'written to data/logs', hLogOff: 'off', hOk: 'normal', hSlow: 'slow',
  },
};
let lang = 'id';
const t = (k, v = {}) => {
  let s = T[lang][k] ?? T.id[k] ?? k;
  for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(String(b));
  return s;
};
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-tp]')) el.placeholder = t(el.dataset.tp);
  buildPreviews();
  buildMutes();
  buildLinks();
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ state
let S = null;
let nextErrorUntil = 0;
let settings = {};
let offset = 0;
let hideSecret = false;
try {
  hideSecret = localStorage.getItem('ctx.hideSecret') === '1';
} catch {
  /* private mode */
}
const sound = new Sound({ music: false });
sound.setVolumes({ music: 0.25, sfx: 0.6, sound: true });

function toast(msg, err = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast${err ? ' err' : ''}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

let msgId = 0;
const pending = new Map();
function send(t2, body = {}) {
  const id = ++msgId;
  net.send({ t: t2, id, ...body });
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => pending.delete(id) && resolve({ ok: false, error: 'timeout' }), 4000);
  });
}
const action = (name, args) => send('action', { name, args });
const setSetting = (patch) => send('settings', { patch });

// ------------------------------------------------------------------ render
function setSwitch(id, on, disabled = false) {
  const el = $(id);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
  el.disabled = disabled;
}
function setSeg(id, value, disabledValues = []) {
  for (const b of $(id).querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === String(value));
    b.disabled = disabledValues.includes(b.dataset.v);
  }
}

function render() {
  if (!S) return;
  const st = S.state;
  const r = st.round;
  const status = S.status;
  // header pills
  const pl = $('pillLive');
  pl.className = `pill ${status.live ? 'ok' : status.sim ? 'warn' : 'bad'}`;
  $('liveText').textContent = status.live
    ? t('liveOn', { u: status.username })
    : status.sim
      ? t('simOn')
      : !status.liveConfigured
        ? t('liveNoKey')
        : status.liveStatus === 'reconnecting'
          ? t('liveConnecting')
          : t('liveOff');
  const audio = status.overlayAudio || [];
  $('pillOverlay').className = `pill ${!status.overlays ? 'bad' : audio.includes('running') ? 'ok' : 'warn'}`;
  $('overlayText').textContent = status.overlays ? t('overlays', { n: status.overlays }) : t('noOverlay');
  $('overlayAudio').textContent = !status.overlays ? '' : audio.includes('running') ? t('audioRunning') : audio.includes('blocked') ? t('audioBlocked') : t('audioOff');

  // round
  const ph = $('phase');
  ph.className = `phase ${st.phase}`;
  ph.textContent = r ? `${t('roundN', { n: r.no })} · ${t(st.phase)}` : t(st.phase);
  const word = S.state.secret ?? (r?.ended ? r.result?.word : null);
  const sec = $('secret');
  sec.textContent = word || t('noRound');
  sec.className = `secret${!word ? ' none' : ''}${word && hideSecret ? ' blur' : ''}`;
  $('toggleSecret').textContent = hideSecret ? t('show') : t('hide');
  if (r) {
    const open = r.revealed.filter((x) => x.how !== 'end').map((x) => `${x.i + 1}:${x.ch.toUpperCase()}`).join(' ');
    $('secretMeta').textContent = [t('letters', { n: r.length }), r.wordClass || t('unknownClass'), open ? t('revealed', { x: open }) : ''].filter(Boolean).join(' · ');
  } else $('secretMeta').textContent = '';
  $('cGuesses').textContent = String(r?.guessCount ?? 0);
  $('cGifts').textContent = r ? `${r.giftsUsed}/${r.giftsMax}` : '0/3';
  const best = r?.board?.[0];
  $('cBest').textContent = best ? `${best.word}${r.mode === 'vector' ? (best.rank ? ` #${best.rank}` : '') : ` ${Math.round(best.warmth * 100)}%`}` : '–';
  document.querySelector('[data-action="start"]').disabled = st.phase === 'playing';
  document.querySelector('[data-action="reveal"]').disabled = st.phase !== 'playing';
  if (Date.now() > nextErrorUntil) {
    $('nextInfo').textContent = st.nextOverride ? t('nextSet', { w: st.nextOverride }) : t('nextRandom');
    $('nextInfo').className = 'hint';
  }

  // controls
  setSwitch('swSim', status.sim, status.live && !status.sim);
  $('simNote').textContent = status.live ? t('simLive') : t('simNote');
  setSwitch('swSound', settings.sound);
  setSeg('segLayout', settings.layout);
  setSeg('segMode', st.mode, st.vectorsAvailable ? [] : ['vector']);
  $('modeNote').textContent = st.vectorsAvailable ? t('modeVectorsOk') : t('modeNoVectors');
  setSeg('segTop', settings.boardTop);

  // settings (do not overwrite a field the streamer is typing in)
  if (document.activeElement !== $('hintGift')) $('hintGift').value = settings.hintGift;
  if (document.activeElement !== $('cooldown')) $('cooldown').value = String((settings.cooldownMs ?? 2000) / 1000);
  setSwitch('swTts', settings.tts);
  setSeg('segLang', settings.lang);
  setSwitch('swDark', settings.dark);
  if (document.activeElement !== $('volMusic')) $('volMusic').value = settings.musicVol;
  if (document.activeElement !== $('volSfx')) $('volSfx').value = settings.sfxVol;
  $('volMusicV').textContent = `${Math.round(settings.musicVol * 100)}%`;
  $('volSfxV').textContent = `${Math.round(settings.sfxVol * 100)}%`;

  // boards
  const sess = st.leaderboard;
  $('sessionEmpty').hidden = sess.length > 0;
  $('sessionList').innerHTML = sess
    .map((p, i) => `<li><span class="t-rank">${i + 1}</span><span class="t-name">${esc(p.name)}${p.sim ? '<span class="tag">SIM</span>' : ''}</span><span class="t-sub">${t('wins', { n: p.wins })}${p.streak >= 2 ? ` · 🔥${p.streak}` : ''}</span><span class="t-pts num">${p.points}</span></li>`)
    .join('');
  const all = S.alltime;
  $('alltimeEmpty').hidden = all.length > 0;
  $('alltimeCount').textContent = S.alltimeCount ? t('count', { n: S.alltimeCount }) : '';
  $('alltimeList').innerHTML = all
    .map((p, i) => `<li><span class="t-rank">${i + 1}</span><span class="t-name">${esc(p.name)}</span><span class="t-sub">${t('wins', { n: p.wins })}</span><span class="t-pts num">${p.points}</span></li>`)
    .join('');

  setSeg('segDiff', st.difficulty || settings.difficulty || 'normal');
  const tc = st.tierCounts || {};
  $('diffNote').textContent = t('diffNote', { easy: tc.easy ?? 0, normal: tc.normal ?? 0, hard: tc.hard ?? 0 });
  setSwitch('swFreeHint', settings.freeHint !== false);
  setSwitch('swStreamerWins', !!settings.streamerCanWin);
  setSwitch('swSceneSafe', !!settings.sceneSafe);
  setSwitch('swReduceFlash', !!settings.reduceFlash);
  renderMutes();
  renderPanic(!!st.panic);
  renderHealth(status.health);

  document.documentElement.dataset.theme = settings.dark ? 'dark' : 'light';
}

function renderPanic(on) {
  $('panicBar').classList.toggle('is-on', on);
  $('panicTitle').textContent = t(on ? 'panicActive' : 'panicIdle');
  $('panicNote').textContent = t(on ? 'panicActiveNote' : 'panicNote');
  $('panicBtn').textContent = t(on ? 'panicOff' : 'panicOn');
  $('panicBtn').classList.toggle('danger', !on);
  $('panicBtn').classList.toggle('primary', on);
  if (on) {
    $('secret').textContent = '••••••';
    $('secret').className = 'secret none';
  }
  for (const b of document.querySelectorAll('[data-action="start"],[data-action="skip"],[data-action="reveal"]')) if (on) b.disabled = true;
}

function renderHealth(h) {
  if (!h) return;
  const ago = h.lastEventAt ? Math.max(0, Math.round((Date.now() + offset - h.lastEventAt) / 1000)) : null;
  const st = S.status;
  const tiktok = st.live ? t('liveOn', { u: st.username }) : st.sim ? t('simOn') : !st.liveConfigured ? t('liveNoKey') : t(st.liveStatus === 'reconnecting' ? 'liveConnecting' : 'liveOff');
  const lag = h.loopLagMs ?? 0;
  const rows = [
    ['hTikTok', tiktok, st.live ? 'ok' : st.sim ? 'warn' : 'bad'],
    ['hReconnect', String(h.reconnects ?? 0), (h.reconnects ?? 0) > 3 ? 'warn' : ''],
    ['hLastEvent', ago == null ? t('hNever') : t('hAgo', { s: ago }), ''],
    ['hRate', String(h.eventsPerMin ?? 0), ''],
    ['hCpu', `${(h.cpuPct ?? 0).toFixed(0)}%`, (h.cpuPct ?? 0) > 70 ? 'warn' : ''],
    ['hMem', `${(h.rssMb ?? 0).toFixed(0)} MB`, ''],
    ['hLag', `${lag.toFixed(0)} ms · ${t(lag > 100 ? 'hSlow' : 'hOk')}`, lag > 100 ? 'warn' : ''],
    ['hOverlays', String(h.overlays ?? 0), h.overlays ? '' : 'warn'],
    ['hControls', String(h.controls ?? 0), ''],
    ['hLog', t(h.logging ? 'hLogOn' : 'hLogOff'), ''],
  ];
  $('healthList').innerHTML = rows.map(([k, v, c]) => `<div class="h-row"><dt>${esc(t(k))}</dt><dd class="num ${c}">${esc(v)}</dd></div>`).join('');
}

function renderMutes() {
  const muted = new Set(settings.mutedFx || []);
  for (const b of document.querySelectorAll('#mutes [data-mute]')) b.setAttribute('aria-checked', muted.has(b.dataset.mute) ? 'false' : 'true');
}

function tick() {
  if (!S) return;
  const st = S.state;
  const now = Date.now() + offset;
  if (st.phase === 'playing' && st.round) $('cTimer').textContent = fmtTime(st.round.revealAt - now);
  else if (st.phase === 'break' && st.breakEndsAt) $('cTimer').textContent = fmtTime(st.breakEndsAt - now);
  else $('cTimer').textContent = '–';
}
setInterval(tick, 250);

const logEl = $('log');
function addLog(e, top = true) {
  const li = document.createElement('li');
  const time = new Date(e.at).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  li.innerHTML = `<time>${time}</time><span class="k-${esc(e.kind)}">${esc(e.text)}</span>`;
  if (top) logEl.prepend(li);
  else logEl.appendChild(li);
  while (logEl.childElementCount > 150) logEl.lastElementChild.remove();
}

// ------------------------------------------------------------------ wiring
for (const b of document.querySelectorAll('[data-action]')) {
  b.addEventListener('click', async () => {
    const r = await action(b.dataset.action);
    if (!r.ok && r.error === 'already-playing') toast(t('alreadyPlaying'), true);
    if (!r.ok && r.error === 'panic') toast(t('panicBlocked'), true);
  });
}
$('toggleSecret').addEventListener('click', () => {
  hideSecret = !hideSecret;
  try {
    localStorage.setItem('ctx.hideSecret', hideSecret ? '1' : '0');
  } catch {
    /* private mode */
  }
  render();
});
$('nextForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = $('nextWord').value.trim();
  if (!word) return;
  const r = await action('setNext', { word });
  if (r.ok) {
    $('nextWord').value = '';
    toast(t('nextSet', { w: r.word }));
  } else {
    nextErrorUntil = Date.now() + 4000;
    $('nextInfo').textContent = t('notInKbbi');
    $('nextInfo').className = 'hint err';
  }
});
$('nextClear').addEventListener('click', () => action('setNext', { word: '' }));

$('swSim').addEventListener('click', async () => {
  const r = await action('sim', { on: !S.status.sim });
  if (!r.ok && r.error === 'live') toast(t('simBlocked'), true);
});
$('swSound').addEventListener('click', () => setSetting({ sound: !settings.sound }));
$('swTts').addEventListener('click', () => setSetting({ tts: !settings.tts }));
$('swDark').addEventListener('click', () => setSetting({ dark: !settings.dark }));
const segHandler = (id, key, conv = (v) => v) =>
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) setSetting({ [key]: conv(b.dataset.v) });
  });
segHandler('segLayout', 'layout');
segHandler('segMode', 'mode');
segHandler('segTop', 'boardTop', Number);
segHandler('segLang', 'lang');
segHandler('segDiff', 'difficulty');
$('swFreeHint').addEventListener('click', () => setSetting({ freeHint: !(settings.freeHint !== false) }));
$('swStreamerWins').addEventListener('click', () => setSetting({ streamerCanWin: !settings.streamerCanWin }));
$('swSceneSafe').addEventListener('click', () => setSetting({ sceneSafe: !settings.sceneSafe }));
$('swReduceFlash').addEventListener('click', () => setSetting({ reduceFlash: !settings.reduceFlash }));
$('panicBtn').addEventListener('click', async () => {
  const on = !S?.state?.panic;
  const r = await action('panic', { on });
  if (r.ok && on) sound.setVolumes({ sound: false });
  else if (r.ok) sound.setVolumes({ sound: true });
});

$('hintGift').addEventListener('change', async () => {
  await setSetting({ hintGift: $('hintGift').value });
  toast(t('saved'));
});
$('cooldown').addEventListener('change', async () => {
  await setSetting({ cooldownMs: Math.round(Number($('cooldown').value) * 1000) });
  toast(t('saved'));
});
$('settingsForm').addEventListener('submit', (e) => e.preventDefault());

let volTimer = null;
for (const [id, key] of [['volMusic', 'musicVol'], ['volSfx', 'sfxVol']]) {
  $(id).addEventListener('input', () => {
    const v = Number($(id).value);
    $(`${id}V`).textContent = `${Math.round(v * 100)}%`;
    if (key === 'sfxVol') sound.setVolumes({ sfx: v });
    else sound.setVolumes({ music: v });
    clearTimeout(volTimer);
    volTimer = setTimeout(() => setSetting({ [key]: v }), 120);
  });
}

let musicOn = false;
$('musicPreview').addEventListener('click', () => {
  musicOn = !musicOn;
  sound.wantMusic = musicOn;
  sound.preview('roundStart');
  sound._applyVolumes();
  $('musicPreview').textContent = musicOn ? t('stop') : t('listen');
  $('musicPreview').classList.toggle('active', musicOn);
});

function buildPreviews() {
  $('previews').innerHTML = EFFECTS.map((e) => `<button class="btn small" type="button" data-fx="${e.id}">${esc(t(`effect_${e.id}`))}</button>`).join('');
}
/** One switch per sound: on = heard. The mute list lives in the settings, so the overlay follows it. */
function buildMutes() {
  $('mutes').innerHTML = FX_GROUPS.map((g) => `<div class="mute"><span>${esc(t(`mute_${g}`))}</span><button class="switch" type="button" role="switch" aria-checked="true" data-mute="${g}" aria-label="${esc(t(`mute_${g}`))}"><span></span></button></div>`).join('');
  renderMutes();
}
$('mutes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mute]');
  if (!b) return;
  const muted = new Set(settings.mutedFx || []);
  if (muted.has(b.dataset.mute)) muted.delete(b.dataset.mute);
  else muted.add(b.dataset.mute);
  setSetting({ mutedFx: [...muted] });
});
$('previews').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fx]');
  if (b) sound.preview(b.dataset.fx);
});

function buildLinks() {
  const base = `${location.protocol}//${location.host}`;
  const links = [
    [t('landscapeLink'), `${base}/`],
    [t('portraitLink'), `${base}/?layout=portrait`],
  ];
  $('links').innerHTML = links
    .map(([label, url]) => `<div class="hint">${esc(label)}</div><div class="link-row"><code>${esc(url)}</code><button class="btn small" type="button" data-copy="${esc(url)}">${esc(t('copy'))}</button></div>`)
    .join('');
}
$('links').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    toast(t('copied'));
  } catch {
    toast(b.dataset.copy);
  }
});

$('exportCsv').href = `/api/alltime.csv${KEY ? `?key=${encodeURIComponent(KEY)}` : ''}`;
$('resetAll').addEventListener('click', () => {
  $('confirmReset').hidden = false;
  $('confirmInput').value = '';
  $('confirmInput').focus();
});
$('confirmCancel').addEventListener('click', () => ($('confirmReset').hidden = true));
$('confirmReset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await action('resetAllTime', { confirm: $('confirmInput').value.trim().toUpperCase() });
  if (r.ok) $('confirmReset').hidden = true;
  else $('confirmInput').focus();
});

// "Klik untuk suara": browsers block audio until the page is clicked
sound.onState((s) => ($('audioUnlock').hidden = s !== 'blocked'));
$('audioUnlock').addEventListener('click', () => sound.preview('roundStart'));

const net = new Net({
  role: 'control',
  key: KEY,
  onState: (msg) => {
    const langChanged = msg.settings.lang !== settings.lang;
    S = msg;
    settings = msg.settings;
    offset = msg.state.serverNow - Date.now();
    if (langChanged) {
      lang = settings.lang === 'en' ? 'en' : 'id';
      applyLang();
      sound.setVolumes({ music: settings.musicVol, sfx: settings.sfxVol });
    }
    render();
    tick();
  },
  onMessage: (msg) => {
    if (msg.t === 'result') {
      const res = pending.get(msg.id);
      if (res) {
        pending.delete(msg.id);
        res(msg);
      }
    } else if (msg.t === 'log') addLog(msg.entry);
    else if (msg.t === 'logs') {
      logEl.innerHTML = '';
      for (const e of msg.entries) addLog(e);
    }
  },
});

applyLang();
