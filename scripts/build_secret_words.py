"""Build the secret-word list (common, base-form KBBI words) from the KBBI CSV.

Usage: python3 scripts/build_secret_words.py [path/to/kbbi.csv] [--top N]

Writes data/secret_words.txt (one word per line, highest-scoring first) and
data/secret_words_report.txt (counts plus a sample to review by hand).
Both output files are git-ignored; the dictionary data must never be committed.
"""
import argparse, csv, os, re, sys, collections

SEP = ' | '
WORD = re.compile(r'^[a-z]{4,8}$')
# Word-class tags that make good answers (primary class = first value)
GOOD_CLASS = {'Nomina', 'Verba', 'Adjektiva'}
# Register tags that mean archaic, classical, vulgar or obsolete usage
BAD_RAGAM = {'Arkais', 'Klasik', 'Kasar', 'vul', 'obs'}


def split(value):
    return [v.strip() for v in (value or '').split(SEP) if v.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv', nargs='?', default=os.environ.get('KBBI_CSV', 'data/kbbi.csv'))
    ap.add_argument('--top', type=int, default=20000)
    ap.add_argument('--min-score', type=int, default=2)
    args = ap.parse_args()

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
        # Commonness proxy: productive words have many compound and derived forms and
        # usage examples. KBBI has no frequency data, so this is a heuristic.
        score = len(d['gabungan_kata']) + len(d['turunan']) + 2 * len(d['contoh'])
        if score < args.min_score:
            stats[f'too few usage signals (score < {args.min_score})'] += 1
            continue
        scored.append((score, kata))

    scored.sort(key=lambda x: (-x[0], x[1]))
    chosen = [w for _, w in scored[:args.top]]

    os.makedirs('data', exist_ok=True)
    with open('data/secret_words.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(chosen) + '\n')

    import random
    random.seed(1)
    sample = random.sample(chosen, min(200, len(chosen)))
    with open('data/secret_words_report.txt', 'w', encoding='utf-8') as f:
        f.write('Filter counts (words rejected at each step):\n')
        for k, v in stats.most_common():
            f.write(f'  {v:>8}  {k}\n')
        f.write(f'\nPassed all filters: {len(scored)}\nWritten (top {args.top}): {len(chosen)}\n\n')
        f.write('Random sample to review by hand (remove weird ones, then add them to data/blocklist.txt):\n')
        f.write('\n'.join(sample) + '\n')
    print(open('data/secret_words_report.txt', encoding='utf-8').read())


if __name__ == '__main__':
    sys.exit(main())
