// Configuration from environment variables (and an optional .env file).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tiny .env loader (KEY=value lines). Real environment variables win. */
export function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase());

export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  if (env === process.env) loadDotEnv(path.join(ROOT, '.env'));
  const flag = (name) => argv.includes(`--${name}`);
  const demo = flag('demo');
  const fixture = (f) => path.join(ROOT, 'test', 'fixtures', f);
  const resolve = (p) => path.resolve(ROOT, p);
  return {
    port: Number(env.PORT) || 3000,
    // localhost only by default: the control page shows the answer
    host: env.HOST || '127.0.0.1',
    kbbiCsv: env.KBBI_CSV ? resolve(env.KBBI_CSV) : demo ? fixture('kbbi_sample.csv') : resolve('data/kbbi.csv'),
    secretWords: env.SECRET_WORDS ? resolve(env.SECRET_WORDS) : demo ? fixture('secret_words.txt') : resolve('data/secret_words.txt'),
    secretWordsEasy: env.SECRET_WORDS_EASY ? resolve(env.SECRET_WORDS_EASY) : resolve('data/secret_words_easy.txt'),
    secretWordsHard: env.SECRET_WORDS_HARD ? resolve(env.SECRET_WORDS_HARD) : resolve('data/secret_words_hard.txt'),
    eventLog: !['0', 'false', 'no', 'off'].includes(String(env.EVENT_LOG ?? '').toLowerCase()),
    vectorsPath: env.VECTORS_PATH ? resolve(env.VECTORS_PATH) : '',
    vectorsMaxLines: Number(env.VECTORS_MAX_LINES) || 200000,
    dataDir: resolve(env.DATA_DIR || 'data'),
    streamchimeKey: String(env.STREAMCHIME_APP_KEY || '').trim(),
    tiktokUsername: String(env.TIKTOK_USERNAME || '').replace(/^@/, '').trim(),
    hintGift: String(env.HINT_GIFT || '').trim() || 'Rose',
    controlKey: String(env.CONTROL_KEY || '').trim(),
    sim: flag('sim') || demo || bool(env.SIM),
    demo,
    autoStart: flag('sim') || demo || bool(env.AUTO_START),
    simIntensity: Number(env.SIM_INTENSITY) || 1,
    debugLive: bool(env.DEBUG_LIVE),
  };
}
