# Contexto Indo

An Indonesian word-guessing game for TikTok LIVE, in the style of Contexto. Viewers type guesses in chat. Every guess is ranked by how close its meaning is to the secret word, so the board is always ordered from closest to farthest. Rank 1 is the answer. The on-screen and chat text is in Bahasa Indonesia, with an English toggle.

It is a fork of [Wordle Indo](https://github.com/osasgti/wordleindo). The look, sound, popups, ops features and the TikTok adapter are the same. The letter mode is gone.

The game has two pages:

- The **overlay** (`/`) goes into OBS.
- The **control page** (`/control`) is for the streamer only. It shows the answer, so it must never be captured by OBS.

## Setup

You need Node.js 22 or newer, and Python 3 if you rebuild the word list.

```bash
git clone https://github.com/osasgti/contextoindo.git
cd contextoindo
npm install          # installs the Streamchime SDK (the only dependency, optional)
cp .env.example .env # then fill in the values (see below)
```

Try it first with no data of your own:

```bash
npm run demo         # sample dictionary, 12 sample vectors, and the simulator
```

For the real game, put the data in `data/`. This folder is git-ignored and must never be committed.

| File | What it is |
| --- | --- |
| `data/kbbi.csv` | KBBI CSV. The `kata` column is the list of valid guesses. The game only reads it. It is copyrighted, so keep it private. |
| `data/secret_words.txt` | Secret answers, one per line. Built by `scripts/build_secret_words.py`. Each secret needs a vector, or it is skipped. |
| `data/blocklist.txt` | Words you removed by hand. The build script skips them. |
| `data/cc.id.300.vec` | Word vectors: a word2vec text file, for example fastText Indonesian. This is what ranks the guesses. |

Commands:

```bash
npm start            # real game: connects to TikTok LIVE if STREAMCHIME_APP_KEY is set
npm run sim          # simulator only: fake viewers, never connects to LIVE
npm run test-mode    # the same as npm run sim
npm run demo         # no data needed: sample dictionary, sample vectors, simulator
npm test             # all tests (never reads the real vector file)
npm run contrast     # checks the text colours against WCAG AA
npm run bench        # times the ranking and the guess flood
npm run build-secrets
```

If `npm start` can't connect to LIVE (no key, no username, or an error), it says why in the terminal and starts the simulator. Turn the simulator off on the control page. It also turns off by itself once LIVE connects, and it can't be turned on while LIVE is connected.

## Environment variables

See `.env.example` for a copy you can fill in.

| Variable | Default | What it does |
| --- | --- | --- |
| `VECTORS_PATH` | empty (demo: `test/fixtures/vectors.vec`) | **Required for ranking.** Path to a word2vec text file. Without it the game still starts, says so in the terminal and on the control page, and every guess is out of range. |
| `VECTORS_MAX_LINES` | `200000` | How many lines of the vector file to read. The file is sorted by frequency, so this keeps the common words. |
| `STREAMCHIME_APP_KEY` | empty | Streamchime app key for TikTok LIVE. Get a free Hobby key at streamchime.com/app/developers. |
| `TIKTOK_USERNAME` | empty | The TikTok account to read chat from, without the `@`. |
| `HINT_GIFT` | `Rose` | Gift that opens one letter. You can also change it on the control page. |
| `KBBI_CSV` | `./data/kbbi.csv` | Path to the KBBI CSV. |
| `SECRET_WORDS` | `./data/secret_words.txt` | Path to the secret word list. |
| `SECRET_WORDS_EASY` | `./data/secret_words_easy.txt` | Optional pack for **Easy**. When the file is missing, Easy uses words of 5 letters or fewer from the main list. |
| `SECRET_WORDS_HARD` | `./data/secret_words_hard.txt` | Optional pack for **Hard**. When the file is missing, Hard uses words of 8 letters or more from the main list. |
| `EVENT_LOG` | on | Set to `0` to stop writing the rotating event log. |
| `PORT` | `3000` | Web server port. |
| `HOST` | `127.0.0.1` | Keeps the control page on this computer only. |
| `CONTROL_KEY` | empty | Password for the control page (`/control?key=...`). When `HOST` is not localhost and no key is set, one is generated and printed at startup. |
| `AUTO_START` | off | Start a round as soon as the server starts. |
| `DEBUG_LIVE` | off | Print every raw Streamchime event, to check the field names. |
| `DATA_DIR` | `./data` | Where settings, scores and logs are saved. |
| `SIM_INTENSITY` | `1` | How busy the simulator's chat is. |

The `mode` setting from Wordle Indo is gone. An old `data/settings.json` that still has it loads without error, and the field is ignored.

No secrets are hard-coded. Keys live only in `.env`, which is git-ignored.

## How the ranking works

- The vector file is loaded once at startup. Each word becomes a row of numbers, normalised to length 1, so the cosine similarity of two words is a dot product.
- When a round starts, the game computes the similarity of every known word to the secret, and ranks them. Words with the same similarity share a rank (competition ranking: 1, 2, 2, 4). The secret is rank 1.
- A guess gets the rank of its word. The board sorts by rank, best first.
- **Closeness** is the bar on each row: `closeness(rank, N) = 1 − ln(rank) / ln(N)`, clamped to 0–1, where N is the number of vectors loaded. Rank 1 is 1.0 and the last rank is 0. It sets the row colour, the heat of the round, and the sound.
- A KBBI word with no vector is **di luar jangkauan** (out of range). It counts as a guess, shows no rank and no bar, and never wins the close call.
- Guesses are never cut or padded to the answer's length. The hero shows the answer's length as hidden tiles.

## OBS

Add a **Browser Source** for the layout you stream in:

| Layout | URL | Size |
| --- | --- | --- |
| Landscape | `http://localhost:3000/` | 1920 × 1080 |
| Portrait | `http://localhost:3000/?layout=portrait` | 1080 × 1920 |

- Tick **Control audio via OBS** to send the game sound into your stream.
- Optional URL options:
  - `?sound=0` mutes everything.
  - `?music=0` mutes only the music.
  - `?volume=0.5` sets the master volume.
  - `?lang=en` forces English.
  - `?transparent=1` removes the dark background.
  - `?motion=0` turns animation off.
  - `?flash=0` turns on "reduce flashing" for this source (the control page switch does the same for every overlay).
  - `?bench=1` shows a small box with the overlay's own cost per frame.
- Open the control page in a normal browser, never in OBS: `http://localhost:3000/control`.

If the control page says overlay audio is blocked, right-click the source in OBS, choose **Interact**, and click once.

## How a round works

1. A random secret word is picked from the difficulty's pool. It is never the same as the previous round's word. You can set the next word on the control page.
2. The word's length and class (Nomina, Verba, Adjektiva) show from the start.
3. Anyone in chat can guess, and no follow is needed:
   - Type one word, or `!word`. Any length counts, and the rank decides.
   - Each viewer gets one guess every 2 seconds. Extra guesses are ignored.
   - A word already on the board is ignored.
   - A word not in KBBI gets the reply "Kata tidak ada dalam KBBI." (see "Private replies").
4. At 3:00 the first letter is revealed. At 6:00 the answer is revealed, nobody scores, and the 15-second break starts.
5. The first correct guess wins and starts the break.
6. **Gift hints**: the configured gift (default Rose) opens one random hidden letter. One viewer can use several per round, and a round allows 3 in total (`RULES.giftHintsPerRound` and `RULES.giftHintsPerViewer` in `src/game/game.js`). Gift hints never give points. Before 3:00 they never open the first letter, and they always leave at least one other letter hidden.
7. Typing `!main` shows a player card with the viewer's name and win streak.

### Chat commands

A message that is exactly `!main`, `!hint`, `!top`, `!streak` or `!ronde` is a command, not a guess. So `!top` is never a guess of the word "top"; type the plain word (`top`) to guess it.

| Command | What it does |
| --- | --- |
| `!main` | Joins the game and shows your player card. |
| `!hint` | Opens one free letter, shared by everyone. Allowed once per round, from 1:00 on, and never the first letter before 3:00 or the last hidden letter. Turn it off on the control page. |
| `!top` | Shows the session top 3 as a card. |
| `!streak` | Shows your own win streak, wins and points. |
| `!ronde` | Shows the round number and the time left. |

Commands are rate limited so chat cannot flood the screen: `!top`, `!streak` and `!ronde` work once per viewer every 20 seconds, and show one card of each kind every 6 seconds.

### Game feel

- **Hot streak**: 8 guesses within 10 seconds start a "Tebakan beruntun" state for 6 seconds, with a counter card, a warmer glow, and a sound. It cools down for 25 seconds before it can start again.
- **Close call**: the first guess of a round that ranks 2nd or 3rd gets a sting and a name card. It fires once per round, and never for an out-of-range word.
- **Round recap**: the win and reveal cards show the KBBI meaning of the word, how many guesses and players there were, the closest runner-up (the closest guess that was not the answer), and who opened the first letter.
- **Difficulty**: Easy, Normal and Hard on the control page. It changes which word pack the next round draws from. It never changes the answer format, the round length, or the scoring. Normal uses the whole list. Easy and Hard are the subsets described in the table above, and the hard words are also in Normal.
- **Anti-spam**: one guess per viewer every 2 seconds, no repeated words. A correct guess from the streamer's own account (`TIKTOK_USERNAME`) is ignored unless you switch on "Streamer's own win counts".

### Sound

All sound is made in the browser with Web Audio, so there are no sound files. Everything is in one key (A minor pentatonic), so effects never clash with the music.

- An ambient bed with layers that join at 3:00 and 5:00, and a tension filter that opens in the last minute.
- A soft tick for each guess. A drone follows the closest guess, and a new best guess plays a soft chord.
- Gifts have chimes in the same key; a gift that is not in the list gets a neutral bell.
- Wins have a fanfare that grows with the streak.
- A reveal falls, goes silent for a moment, then lands. The break is one slow rise that resolves into the next round's start chime.
- The music ducks while the browser reads the winner aloud. A voice cap and a limiter keep the mix from clipping.
- Every sound can be previewed and muted on its own on the control page, and every sound has a visual cue on the overlay.

### Points

- **Win**: 100 points, plus a speed bonus of up to 50. The bonus is 50 at 0:00 and drops linearly to 0 at 3:00, so a win after the first-letter hint gets 100.
- **Streak**: winning rounds in a row adds +10 on the 2nd win, +20 on the 3rd, then +30 per win at most. The streak ends when someone else wins.
- **Helper points**: each non-winner's best guess of the round earns 10 points at rank 2-3, or 5 points at rank 4-10.
- **Ties** on the session board go to whoever reached that total first.
- **Simulator players** are tagged SIM. They're saved in `data/scores.json` with `sim: true`, but never appear on the all-time board or in the CSV export.

### Private replies

TikTok does not let apps send private chat messages, so "Kata tidak ada dalam KBBI." can't be delivered to the viewer. The reply is logged on the control page instead. `ChatSource.reply()` is where to add it if a provider ever supports it.

## Control page

| Section | What's there |
| --- | --- |
| Round | The answer, which you can hide. Buttons to start a round, skip the word, reveal it, or set the next word. |
| Panic button | One click stops sound, freezes the round and its clock, and hides the answer on the overlay and on this page. Click again to resume. |
| Controls | Simulator, overlay sound, layout, difficulty (with how many words each pack has), and top 5 or top 10 on the overlay. Buttons to reset the session or clear the scoreboard. |
| Settings | Hint gift name, guess cooldown, free `!hint`, streamer's own win counts, scene-safe mode, reduce flashing, text-to-speech for the winner, language (Indonesia or English), dark mode. |
| Sound | Music and effects sliders, a preview button for each effect, and a mute switch for each sound. Previews play on the control page, not on the stream. |
| Health | TikTok state, reconnect count, time of the last event, events per minute, CPU, memory, event-loop lag, and how many overlays and control pages are open. |
| All time | The saved board. Export it as CSV, or reset it (you type HAPUS to confirm). |
| Activity | A log of guesses, wins, gifts and KBBI replies. |

Settings are saved in `data/settings.json`.

### Stream safety

- **Panic**: while panic is on, no round action works, the answer is hidden everywhere, no sound plays, and chat guesses are ignored. Resuming moves the round's timers forward by the time it was paused, so nobody loses time.
- **Scene-safe mode**: viewer names and photos become short codes (`Pemain 7QK`) on the overlay and in the spoken winner, so a name never appears on stream. The control page and event log still show real names.
- **Event log**: guesses, wins, gifts and admin actions are written to `data/logs/events.log` as JSON lines. The file rotates at 2 MB and keeps 5 old files. It contains viewer names, so keep `data/` private and set `EVENT_LOG=0` if you do not want it.

### Accessibility

- Animation follows the system's "reduce motion" setting. **Reduce flashing** is a separate switch that also removes blinking, shaking, trails and dense confetti.
- Text colours meet WCAG AA contrast on the dark overlay and on both themes of the control page. Run `npm run contrast` to check it again after you change colours.
- Every sound has a visual equivalent: a card, a glow, a pulse on the timer, or a tile animation.

### Performance

The overlay is built to stay under 5 ms of script per frame. Open `/?bench=1` to see the overlay's own cost on your machine, and run `npm run bench` for the ranking and the guess flood. A headless browser without a GPU is much slower than OBS on a laptop, so its numbers are an upper bound.

## Rebuild the secret word list

```bash
python scripts/build_secret_words.py            # reads data/kbbi.csv (or KBBI_CSV)
# review data/secret_words_report.txt, add odd words to data/blocklist.txt, then run it again
```

Restart the game afterwards to load the new list.

## Project layout

```
src/
  server.js            HTTP + WebSocket server, control actions, wiring
  config.js            env and .env loading
  kbbi.js              CSV parser and KBBI dictionary
  secrets.js           secret list and random pick
  scores.js            all-time board (data/scores.json), CSV export
  settings.js          streamer settings (data/settings.json)
  game/game.js         round state machine, hints, gifts, points, boards
  game/guess.js        one-word rule, !kata, chat commands
  game/vectors.js      word2vec loading and the per-round rank table
  game/ranker.js       competition ranks (ties share a rank)
  game/closeness.js    the closeness curve, 1 - ln(rank)/ln(N)
  game/points.js       win, speed, streak and helper points
  eventlog.js          rotating JSON-lines event log
  health.js            CPU, memory, event-loop lag, last event time
  live/source.js       ChatSource interface (onChat, onJoin, onFollow, onLike, onGift)
  live/streamchime.js  the only TikTok-specific file
  live/sim.js          simulator
public/
  index.html           overlay      control.html   control page
  js/overlay.js        overlay rendering, popups, fx
  js/shared/popup-queue.js   popup priority queue (also used by tests)
  js/audio.js          Web Audio engine
test/                  node --test suites and small fixtures (fixtures/vectors.vec is 12 words)
```

Fonts: Unbounded and Plus Jakarta Sans, self-hosted under the SIL Open Font License (see `public/fonts`).
