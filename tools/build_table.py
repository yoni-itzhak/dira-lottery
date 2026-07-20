"""Build the full apartment table from decoded sheet text."""
import re, csv, sys
from extract_blocks import load, group_rows

FLOOR_TITLES = []  # (title_x, floor_label)

def parse_block(rows):
    d = {}
    for y, t in rows:
        t = re.sub(r'\s*\.\s*', '.', t).strip()
        if 'בניין' in t and 'מס' in t:
            m = re.search(r'(\d+)', t)
            if m: d['building'] = int(m.group(1))
        elif 'טיפוס' in t:
            m = re.search(r'(\d+\s*(?:-|\s)\s*[A-Za-z]\d*)', t)
            if m: d['type'] = re.sub(r'[\s-]+', '', m.group(1))
        elif 'שטח דירה' in t:
            m = re.search(r'(\d+\.?\d*)\s*m', t)
            if m: d['area'] = float(m.group(1))
        elif 'דירה' in t and 'מס' in t:
            m = re.search(r'(\d+)', t)
            if m: d['apt'] = int(m.group(1))
        elif 'חדרים' in t:
            m = re.search(r'(\d+\.?\d*)', t)
            if m: d['rooms'] = float(m.group(1))
        elif 'כיוון' in t:
            dirs = t.replace('כיוון', '').replace('אוויר', '').strip(' -')
            if dirs: d['direction'] = dirs
        elif 'מחיר מטרה' in t and 'שייכות' not in t:
            d['program'] = True
        elif re.match(r'^עד \d+', t) or 'עד' in t and 'ר"מ' in t:
            pass
    return d

def floor_for_x(x, titles):
    cands = [t for t in titles if t[0] >= x - 5]
    if not cands: return '?'
    return min(cands)[1]

def get_floor_titles(toks):
    # big titles at the caption row
    caps = [t for t in toks if t[2] > 35 and 3270 < t[1] < 3300]
    rows = {}
    for x, y, em, s in caps:
        rows.setdefault(round(y), []).append((x, s))
    titles = []
    ycap = max(rows, key=lambda k: len(rows[k]))
    items = sorted(rows[ycap])
    # join fragments belonging to same title (within 300mm)
    cur = []
    for x, s in items:
        if cur and x - cur[-1][0] > 600:
            titles.append((cur[0][0], ''.join(w for _, w in cur)))
            cur = []
        cur.append((x, s))
    if cur: titles.append((cur[0][0], ''.join(w for _, w in cur)))
    out = []
    for x, label in titles:
        label = label.replace('קומה', '').replace('קומות', '').strip()
        out.append((x, label))  # title sits at the panel's bottom-right edge
    return out

def norm_floor(label):
    lab = label.strip()
    m = re.match(r'^0?(\d+)$', lab)
    if m: return m.group(1)
    return lab

def extract(path):
    toks = load(path)
    titles = get_floor_titles(toks)
    anchors = [(x, y) for x, y, em, s in toks if s.strip() == 'טיפוס דירה' and em > 5]
    apts = {}
    for xl, yl in anchors:
        win = [t for t in toks
               if xl - 75 <= t[0] <= xl + 65 and yl - 32 <= t[1] <= yl + 65 and t[2] > 5]
        b = parse_block(group_rows(win, tol=2.6))
        if 'apt' not in b or 'building' not in b:
            print(f'WARN incomplete block at {xl:.0f},{yl:.0f}: {b}', file=sys.stderr)
            continue
        b['floor'] = norm_floor(floor_for_x(xl, titles))
        b['_x'], b['_y'] = xl, yl
        key = (b['building'], b['apt'])
        if key in apts:
            if apts[key] != {**apts[key], **{k:v for k,v in b.items() if k not in('_x','_y')}}:
                pass
        apts[key] = b
    return apts, titles

if __name__ == '__main__':
    apts, titles = extract('decoded/03.txt')
    print('floor panels:', titles, file=sys.stderr)
    # duplicate typical floor "2-3": floor-3 apt = floor-2 apt + 5
    extra = {}
    for (bld, apt), b in apts.items():
        if b['floor'] == '2-3':
            b2 = dict(b); b2['apt'] = apt + 5; b2['floor'] = '3'
            b['floor'] = '2'
            extra[(bld, apt + 5)] = b2
    apts.update(extra)
    w = csv.writer(sys.stdout)
    w.writerow(['building','apt','floor','type','rooms','area_m2','direction','mechir_matara'])
    for (bld, apt), b in sorted(apts.items()):
        w.writerow([bld, apt, b.get('floor'), b.get('type'), b.get('rooms'),
                    b.get('area'), b.get('direction'), 'Y' if b.get('program') else ''])
    n = len(apts); ny = sum(1 for b in apts.values() if b.get('program'))
    print(f'total={n} mechir_matara={ny}', file=sys.stderr)
