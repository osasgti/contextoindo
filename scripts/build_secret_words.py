"""Build the secret-word list (common, base-form KBBI words) from the KBBI CSV.

Usage: python3 scripts/build_secret_words.py [path/to/kbbi.csv] [--top N] [--vectors PATH] [--vector-lines N]

Writes data/secret_words.txt (one word per line, highest-scoring first) and
data/secret_words_report.txt (counts plus a sample to review by hand).
Both output files are git-ignored; the dictionary data must never be committed.

With a vector file (default: VECTORS_PATH from .env), only words the game can rank are kept:
words that appear in the first --vector-lines lines of that file (default: VECTORS_MAX_LINES
from .env, else 200000), using the same rules as src/game/vectors.js.
Pass --vectors "" to build without that filter.
"""
import argparse, csv, os, re, sys, collections

SEP = ' | '
WORD = re.compile(r'^[a-z]{4,8}$')
VECTOR_WORD = re.compile(r'[a-z]+(?:-[a-z]+)*')
# Word-class tags that make good answers (primary class = first value)
GOOD_CLASS = {'Nomina', 'Verba', 'Adjektiva'}
# Register tags that mean archaic, classical, vulgar or obsolete usage
BAD_RAGAM = {'Arkais', 'Klasik', 'Kasar', 'vul', 'obs'}


def split(value):
    return [v.strip() for v in (value or '').split(SEP) if v.strip()]


def read_env(path='.env'):
    """Plain KEY=VALUE lines from .env. A missing file gives an empty dict."""
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding='utf-8') as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    return values


def load_vector_words(path, max_lines):
    """Words that src/game/vectors.js loads from this file, reading only the first max_lines lines."""
    words, seen, dim = set(), set(), 0
    with open(path, encoding='utf-8') as f:
        for lineno, line in enumerate(f, start=1):
            if lineno > max_lines:
                break
            line = line.rstrip('\r\n')
            if lineno == 1:
                head = line.strip().split()
                if len(head) == 2 and all(x.isdigit() for x in head):
                    dim = int(head[1])
                    continue
            sp = line.find(' ')
            if sp <= 0:
                continue
            w = line[:sp].lower()
            if w in seen or not VECTOR_WORD.fullmatch(w):
                continue
            parts = line[sp + 1:].strip().split(' ')
            if not dim:
                dim = len(parts)
            if len(parts) != dim:
                continue
            seen.add(w)
            words.add(w)
    return words


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv', nargs='?', default=os.environ.get('KBBI_CSV', 'data/kbbi.csv'))
    ap.add_argument('--top', type=int, default=20000)
    ap.add_argument('--min-score', type=int, default=2)
    ap.add_argument('--vectors', default=None, help='word vector file; default VECTORS_PATH from .env; "" turns the filter off')
    ap.add_argument('--vector-lines', type=int, default=None, help='lines of the vector file to read; default VECTORS_MAX_LINES from .env, else 200000')
    args = ap.parse_args()

    env = {**read_env(), **os.environ}
    vectors_path = env.get('VECTORS_PATH', '') if args.vectors is None else args.vectors
    vector_lines = args.vector_lines or int(env.get('VECTORS_MAX_LINES') or 0) or 200000

    vec_words = None
    if vectors_path:
        if not os.path.exists(vectors_path):
            sys.exit(f'Vector file not found: {vectors_path}. Fix VECTORS_PATH in .env, or pass --vectors "" to build without it.')
        vec_words = load_vector_words(vectors_path, vector_lines)
        print(f'vectors: {len(vec_words):,} words in the first {vector_lines:,} lines of {vectors_path}')
    else:
        print('vectors: none, the list is not filtered by vectors')

    csv.field_size_limit(10 ** 9)
    with open(args.csv, encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    print(f'rows read: {len(rows)}')

    # Merge rows that share a headword (KBBI often splits one word into several entries)
    merged = collections.defaultdict(lambda: collections.defaultdict(list))
    derived = set()       # words that appear inside another entry's turunan (derived forms)
    for r in rows:
        kata = r['kata'].strip().lower()
        derived.update(split(r['turunan']))
        for field in ('tags_kelas', 'tags_ragam', 'tags_bidang', 'makna', 'contoh', 'turunan', 'gabungan_kata'):
            merged[kata][field].extend(split(r[field]) if field != 'makna' else ([r[field]] if r[field].strip() else []))

    blocklist = set()
    if os.path.exists('data/blocklist.txt'):
        with open('data/blocklist.txt', encoding='utf-8') as f:
            blocklist = {line.strip().lower() for line in f if line.strip() and not line.startswith('#')}

    stats = collections.Counter()
    scored = []
    for kata, d in merged.items():
        stats['candidates'] += 1
        if not WORD.match(kata):
            stats['not a plain a-z word 4-8 letters'] += 1
            continue
        if kata in derived:
            stats['derived form (listed in another turunan)'] += 1
            continue
        classes = d['tags_kelas']
        if not classes or classes[0] not in GOOD_CLASS:
            stats['word class not Nomina/Verba/Adjektiva'] += 1
            continue
        if not d['makna']:
            stats['no definition'] += 1
            continue
        if BAD_RAGAM & set(d['tags_ragam']):
            stats['archaic/classical/vulgar register'] += 1
            continue
        if d['tags_bidang']:
            stats['specialist field term'] += 1
            continue
        if kata in blocklist:
            stats['blocklisted by hand'] += 1
            continue
        if vec_words is not None and kata not in vec_words:
            stats['no vector (the game cannot rank it)'] += 1
            continue
        # Commonness proxy: productive words have many compound and derived forms and
        # usage examples. KBBI has no frequency data, so this is a heuristic.
        score = len(d['gabungan_kata']) + len(d['turunan']) + 2 * len(d['contoh'])
        if score < args.min_score:
            stats[f'too few usage signals (score < {args.min_score})'] += 1
            continue
        scored.append((score, kata))

    if not scored:
        sys.exit('No word passed the filters. Check the CSV, the blocklist and the vector file.')

    scored.sort(key=lambda x: (-x[0], x[1]))
    chosen = [w for _, w in scored[:args.top]]

    os.makedirs('data', exist_ok=True)
    with open('data/secret_words.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(chosen) + '\n')

    import random
    random.seed(1)
    sample = random.sample(chosen, min(200, len(chosen)))
    with open('data/secret_words_report.txt', 'w', encoding='utf-8') as f:
        f.write(f'Vector filter: {vectors_path} (first {vector_lines} lines)\n' if vec_words is not None else 'Vector filter: off\n')
        f.write('Filter counts (words rejected at each step):\n')
        for k, v in stats.most_common():
            f.write(f'  {v:>8}  {k}\n')
        f.write(f'\nPassed all filters: {len(scored)}\nWritten (top {args.top}): {len(chosen)}\n\n')
        f.write('Random sample to review by hand (remove weird ones, then add them to data/blocklist.txt):\n')
        f.write('\n'.join(sample) + '\n')
    print(open('data/secret_words_report.txt', encoding='utf-8').read())


if __name__ == '__main__':
    sys.exit(main())
