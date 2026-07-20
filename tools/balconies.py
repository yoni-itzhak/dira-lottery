"""Extract balcony areas from sheet 001 and assign to apartments."""
import re
from collections import defaultdict, Counter
from extract_blocks import load
from build_table import extract

PANEL_W = 4062.44

def panel_and_region(x, y, titles):
    cands = [t for t in titles if t[0] >= x - 5]
    if not cands: return None, None
    tx, label = min(cands)
    lx = x - (tx - PANEL_W)
    if lx < 2030: return tx, 1
    return tx, 2 if y < 1660 else 3

def run():
    toks = load('decoded/03.txt')
    apts, titles = extract('decoded/03.txt')
    bal = [(x, y) for x, y, em, s in toks if s.strip().startswith('מרפסת שמש')]
    # area tokens: numeric token with an 'm' token immediately right of it (same line)
    mtoks = [(x, y) for x, y, em, s in toks if s.strip() == 'm' and 6 < em < 13]
    nums = []
    for x, y, em, s in toks:
        if not (6 < em < 13): continue
        m = re.match(r'^(\d+(?:\.\d+)?)\s*$', s)
        if not m: continue
        v = float(m.group(1))
        if any(abs(my - y) < 2 and 0 < mx - x < 60 for mx, my in mtoks):
            nums.append((x, y, v))
    res = []
    for bx, by in bal:
        cand = [(abs(nx-bx) + abs(ny-by-22), a) for nx, ny, a in nums
                if abs(nx-bx) < 100 and 3 < ny-by < 55]
        res.append((bx, by, min(cand)[1] if cand else None))
    unresolved = [(bx, by) for bx, by, a in res if a is None]
    # assignment: nearest anchor in same panel+building region
    anchors = {}
    for k, b in apts.items():
        tx, _ = panel_and_region(b['_x'], b['_y'], titles)
        anchors[k] = (b['_x'], b['_y'], tx, b['building'])
    per_apt = defaultdict(list)
    for bx, by, a in res:
        if a is None or a > 40: continue
        tx, reg = panel_and_region(bx, by, titles)
        cands = {k: v for k, v in anchors.items() if v[2] == tx and v[3] == reg}
        if not cands: continue
        key = min(cands, key=lambda k: (cands[k][0]-bx)**2 + (cands[k][1]-by)**2)
        per_apt[key].append(a)
    # majority per (building,type): balcony list
    votes = defaultdict(Counter)
    for k, areas in per_apt.items():
        b = apts[k]
        votes[(b['building'], b.get('type'))][tuple(sorted(areas))] += 1
    type_balcony = {}
    for t, c in votes.items():
        type_balcony[t] = list(c.most_common(1)[0][0])
    return type_balcony, unresolved, per_apt, apts

if __name__ == '__main__':
    tb, unresolved, per_apt, apts = run()
    print(f'unresolved labels: {len(unresolved)} -> {[(round(x),round(y)) for x,y in unresolved]}')
    for t in sorted(tb, key=str):
        print(t, tb[t], 'total', round(sum(tb[t]), 2))
