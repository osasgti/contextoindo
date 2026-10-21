// The board and audience effects: listed everywhere the control page and the server need them,
// audible, silent when muted, and throttled so a burst of events stays calm.
// Web Audio does not exist in Node, so the Sound runs on a stand-in AudioContext and the test
// counts the voices each effect starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, FX_GROUPS, Sound } from '../public/js/audio.js';
import { FX_NAMES, sanitize } from '../src/settings.js';

const NEW = ['rowPop', 'outOfRange', 'climb', 'top3', 'like', 'follow', 'join', 'helper'];

/** A stand-in AudioContext: every node connects, starts and stops, and has automatable params. */
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () =>
    new Proxy(
      {},
      {
        get(target, key) {
          if (key in target) return target[key];
          if (typeof key === 'symbol') return undefined;
          if (key === 'connect') return (dest) => dest;
          if (key === 'start' || key === 'stop' || key === 'disconnect' || key === 'getByteTimeDomainData') return () => {};
          target[key] = param();
          return target[key];
        },
      },
    );
  return {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: node(),
    createGain: node,
    createOscillator: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createDynamicsCompressor: node,
    createWaveShaper: node,
    createAnalyser: node,
    createDelay: node,
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    resume: async () => {},
  };
}

/** A Sound on the stand-in context; `voices` counts every tone, noise, bell and pluck it starts. */
function makeSound() {
  // the Sound reads the URL options and window.AudioContext first, as it does in the browser
  globalThis.location ??= { search: '' };
  globalThis.window ??= {};
  const s = new Sound({ music: false, context: fakeContext(), forceOk: true });
  s.voices = 0;
  for (const k of ['_tone', '_noise', '_bell', '_pluck']) {
    const f = s[k].bind(s);
    s[k] = (...args) => {
      s.voices++;
      return f(...args);
    };
  }
  return s;
}

test('every new effect has a preview button, a mute switch and a name the server accepts', () => {
  for (const name of NEW) {
    assert.ok(FX_GROUPS.includes(name), `${name} has a mute switch`);
    assert.ok(FX_NAMES.includes(name), `${name} is a server-side name`);
    assert.ok(EFFECTS.some((e) => e.id === name && e.fx === name), `${name} has a preview button`);
  }
  assert.deepEqual(sanitize({ mutedFx: NEW }), { mutedFx: NEW }, 'the server keeps every new mute');
});

test('each new effect plays, and stays silent when it is muted or the sound is off', () => {
  for (const name of NEW) {
    const on = makeSound();
    on[name]();
    assert.ok(on.voices > 0, `${name} plays`);

    const muted = makeSound();
    muted.setMuted([name]);
    muted[name]();
    assert.equal(muted.voices, 0, `${name} is silent when muted`);

    const off = makeSound();
    off.setVolumes({ sound: false });
    off[name]();
    assert.equal(off.voices, 0, `${name} is silent when the sound is off`);
  }
});

test('a burst of the same event plays each new effect once', () => {
  for (const name of NEW) {
    const s = makeSound();
    s[name]();
    const once = s.voices;
    for (let i = 0; i < 20; i++) s[name]();
    assert.equal(s.voices, once, `${name} is throttled`);
  }
});

test('the first call of a throttle always passes, even right after the page loads', () => {
  const s = makeSound();
  // a window far longer than this process has run: the old check (now - 0 < ms) dropped this call
  assert.equal(s._throttle('first', 1e9), true);
  assert.equal(s._throttle('first', 1e9), false, 'the second call inside the window is held back');
});

test('the control page preview plays each new effect even when it is muted', () => {
  for (const name of NEW) {
    const s = makeSound();
    s.setMuted(NEW);
    assert.equal(s.preview(name), true, `${name} has a preview`);
    assert.ok(s.voices > 0, `${name} preview is heard`);
    assert.deepEqual([...s.mutedFx].sort(), [...NEW].sort(), 'the mutes come back after the preview');
  }
});
