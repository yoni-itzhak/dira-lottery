"""Parse apartment info blocks from decoded sheet text files."""
import re, sys, csv

def load(path):
    rows = []
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'): continue
        x = float(line[0:10]); y = float(line[11:21]); em = float(line[22:28])
        s = line[30:].rstrip('\n')
        rows.append((x, y, em, s))
    # drop exact-duplicate glyphs (some text is drawn twice at identical coords)
    return list(dict.fromkeys(rows))

def group_rows(tokens, tol=1.5):
    """Group tokens into text rows by y, return list of (y, joined_string)."""
    tokens = sorted(tokens, key=lambda t: (t[1], t[0]))
    out = []
    cur, cury = [], None
    for x, y, em, s in tokens:
        if cury is None or abs(y - cury) <= tol:
            cur.append((x, s)); cury = y if cury is None else cury
        else:
            out.append((cury, ' '.join(s for _, s in sorted(cur))))
            cur, cury = [(x, s)], y
    if cur:
        out.append((cury, ' '.join(s for _, s in sorted(cur))))
    return out

def parse_block(rows):
    """rows: list of (y, text) for one block window."""
    d = {}
    for y, t in rows:
        t = t.replace('. ', '.').strip()
        if 'בניין' in t and 'מס' in t:
            m = re.search(r'(\d+)', t)
            if m: d['building'] = m.group(1)
        elif 'טיפוס' in t:
            m = re.search(r'(\d+\s*-?\s*[A-Za-z]+\d*|[A-Za-z]+\d*\s*-\s*\d+)', t)
            if m: d['type'] = m.group(1).replace(' ', '')
        elif 'דירה' in t and 'מס' in t and 'שטח' not in t:
            m = re.search(r'(\d+)', t)
            if m: d['apt'] = m.group(1)
        elif 'שטח דירה' in t:
            m = re.search(r'(\d+\.?\d*)\s*m', t)
            if m: d['area'] = m.group(1)
        elif 'כיוון' in t:
            dirs = re.sub(r'כיוון|אוויר', '', t).strip()
            if dirs.strip(' -'): d['direction'] = dirs.strip(' -')
        elif 'חדרים' in t:
            m = re.search(r'(\d+\.?\d*)', t)
            if m: d['rooms'] = m.group(1)
        elif 'מחיר מטרה' in t or 'שייכות' in t:
            d['program'] = d.get('program','') + ' ' + t
    # next line after program often has the size cap
    return d

def extract_blocks(path):
    toks = load(path)
    anchors = [(x, y) for x, y, em, s in toks if s.strip() == 'טיפוס דירה' and em > 5]
    blocks = []
    for xl, yl in anchors:
        win = [t for t in toks
               if xl - 75 <= t[0] <= xl + 65 and yl - 32 <= t[1] <= yl + 65
               and t[2] > 5]
        rows = group_rows(win)
        b = parse_block(rows)
        b['_x'], b['_y'] = xl, yl
        blocks.append(b)
    return blocks

if __name__ == '__main__':
    w = csv.writer(sys.stdout, delimiter='\t')
    w.writerow(['sheet','x','y','building','apt','type','rooms','area','direction','program'])
    for path in sys.argv[1:]:
        for b in extract_blocks(path):
            prog = ('מחיר מטרה' in b.get('program','')) if 'program' in b else False
            w.writerow([path, f"{b['_x']:.0f}", f"{b['_y']:.0f}",
                        b.get('building',''), b.get('apt',''), b.get('type',''),
                        b.get('rooms',''), b.get('area',''), b.get('direction',''),
                        'Y' if prog else ''])
