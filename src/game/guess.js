// Turning a chat message into a guess (or a command).

// One word: letters, optionally joined by hyphens (KBBI has words like "kupu-kupu").
const WORD = /^[a-z]+(?:-[a-z]+)*$/;
export const JOIN_COMMAND = '!main';

/**
 * "kata" or "!kata" -> "kata". Anything else (several words, emoji, digits) -> null.
 * The message is trimmed and lowercased first.
 */
export function parseGuess(text) {
  let s = String(text ?? '').trim().toLowerCase();
  if (s.startsWith('!')) s = s.slice(1);
  return WORD.test(s) ? s : null;
}

/** "!main" asks for the join card. It is a command, never a guess. */
export function isJoinCommand(text) {
  return String(text ?? '').trim().toLowerCase() === JOIN_COMMAND;
}

/**
 * Chat commands. A command always wins over a guess, so a KBBI word with the same
 * spelling (for example "!top") cannot be played with the "!" prefix: type it plain.
 */
export const COMMANDS = ['main', 'hint', 'top', 'streak', 'ronde'];

/** "!hint" -> "hint". Anything that is not exactly one known command -> null. */
export function parseCommand(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s.startsWith('!')) return null;
  const name = s.slice(1);
  return COMMANDS.includes(name) ? name : null;
}
