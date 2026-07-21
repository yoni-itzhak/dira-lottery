"""Generate per-apartment plan crops from sheet001_fix.pdf using
type-calibrated offsets relative to each apartment's info-table anchor."""
import subprocess, os, sys, json
from build_table import extract

# panel-local rects (x0,x1 rel. panel left edge; y0,y1 absolute page coords)
PANEL_LEFT = {'0': 36447.39, '1': 32359.19, '2': 28275.23, '3': 28275.23,
              '4': 24241.01, '5': 20172.09, '6': 16113.40, '7': 12049.87 - 4062.44 + 4062.44, '8': 7987.43}
# floor -> panel left edge = title_x - 4062.44
TITLES = {'8': 12049.87, '7': 16112.30, '6': 20175.84, '5': 24234.53,
          '4': 28303.45, '3': 32337.67, '2': 32337.67, '1': 36421.63, '0': 40509.83}
TYPE_RECT = {
    '1A': (480, 1370, 373, 1040),
    '1B': (1290, 2090, 360, 980),
    '1C': (1230, 1955, 940, 1540),
    '1D': (1009, 1660, 1140, 1721),
    '1E': (636, 1365, 881, 1460),
    '2A': (2485, 3214, 390, 1018),
    '2B': (3180, 3812, 390, 1000),
    '2C': (3060, 3730, 860, 1440),
    '2D': (2860, 3450, 1044, 1682),
    '2E': (2388, 3080, 830, 1450),
    '3A': (2587, 3204, 1770, 2290),
    '3B': (3296, 3975, 1788, 2273),
    '3C': (3227, 3947, 2320, 2890),
    '3D': (2860, 3557, 2553, 3202),
    '3E': (2582, 3235, 2303, 2757),
}
APT_RECT = {
    (3, 1): (2765, 3337, 1803, 2324),
    (3, 2): (2600, 3200, 2380, 2830),
}


# entrance door location per type (panel-local x, absolute y)
ENTRY = {
    '1A': (1264, 863), '1B': (1437, 863), '1C': (1519, 1090),
    '1D': (1346, 1185), '1E': (1184, 1085),
    '2A': (3051, 804), '2B': (3291, 804), '2C': (3347, 1110),
    '2D': (3133, 1202), '2E': (3016, 1079),
    '3A': (3026, 2273), '3B': (3378, 2293), '3C': (3378, 2436),
    '3D': (3194, 2467), '3E': (3031, 2436),
}
APT_ENTRY = { (3, 1): (3072, 1997), (3, 2): (3024, 2465) }

def draw_entry(png_path, ex, ey, x0, y0, r):
    from PIL import Image, ImageDraw, ImageFont
    px = 0.75 * r / 72
    img = Image.open(png_path).convert('RGB')
    d = ImageDraw.Draw(img)
    cx, cy = (ex - x0) * px, (ey - y0) * px
    R = 30
    d.ellipse([cx-R, cy-R, cx+R, cy+R], outline=(0, 140, 0), width=7)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 34)
        d.text((cx+R+6, cy-18), 'הסינכ'[::-1][::-1], font=f, fill=(0, 140, 0),
               stroke_width=2, stroke_fill='white')
    except OSError:
        pass
    img.save(png_path)

def load_apartments():
    apts, titles = extract('decoded/03.txt')
    # duplicate typical floors 2-3 (same panel, same anchor)
    extra = {}
    for (b, a), rec in list(apts.items()):
        if rec['floor'] == 'H_F00':
            rec['floor'] = '0'
        if rec['floor'] == '2-3':
            r2 = dict(rec); r2['apt'] = a + 5; r2['floor'] = '3'
            rec['floor'] = '2'
            extra[(b, a + 5)] = r2
    apts.update(extra)
    return apts

def crop(x0, y0, x1, y1, out, r=220, pdf='sheet001_fix.pdf'):
    px = 0.75 * r / 72
    subprocess.run(['pdftocairo', '-png', '-r', str(r),
        '-x', str(int(x0*px)), '-y', str(int(y0*px)),
        '-W', str(int((x1-x0)*px)), '-H', str(int((y1-y0)*px)),
        '-singlefile', pdf, out], check=True)

def main(only=None, outdir='plans_out', r=220):
    os.makedirs(outdir, exist_ok=True)
    apts = load_apartments()
    made = []
    for (b, a), rec in sorted(apts.items()):
        if not rec.get('program'):
            continue
        if only and (b, a) not in only:
            continue
        rect = APT_RECT.get((b, a)) or TYPE_RECT.get(rec.get('type'))
        if not rect:
            print('no rect for', b, a, rec.get('type')); continue
        lx0, lx1, y0, y1 = rect
        L = TITLES[rec['floor']] - 4062.44
        # expand to always include this apartment's own info table
        ax, ay = rec['_x'] - L, rec['_y']
        lx0 = min(lx0, ax - 95); lx1 = max(lx1, ax + 85)
        y0 = min(y0, ay - 50); y1 = max(y1, ay + 80)
        out = f'{outdir}/apt_b{b}_{a}'
        crop(L+lx0, y0, L+lx1, y1, out, r=r)
        e = APT_ENTRY.get((b, a)) or ENTRY.get(rec.get('type'))
        if e:
            draw_entry(out + '.png', L + e[0], e[1], L + lx0, y0, r)
        made.append((b, a, rec.get('type'), out + '.png'))
    print(len(made), 'crops made')
    return made

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'samples':
        only = {(1,2),(1,3),(1,4),(1,5),(1,6),
                (2,1),(2,2),(2,3),(2,4),(2,5),
                (3,4),(3,5),(3,6),(3,7),(3,8),(3,1),(3,2)}
        made = main(only=only, outdir='plans_qa', r=130)
        # build montages per building
        from PIL import Image, ImageDraw
        for b in (1,2,3):
            imgs = [(a,t,Image.open(p)) for (bb,a,t,p) in made if bb==b]
            th = 420
            tiles = []
            for a,t,im in imgs:
                im.thumbnail((th*2, th))
                tiles.append((a,t,im))
            w = max(im.width for _,_,im in tiles) + 20
            cols = 2
            rows = (len(tiles)+cols-1)//cols
            M = Image.new('RGB', (w*cols, (th+40)*rows), 'white')
            d = ImageDraw.Draw(M)
            for i,(a,t,im) in enumerate(tiles):
                cx, cy = (i%cols)*w+10, (i//cols)*(th+40)+30
                M.paste(im, (cx, cy))
                d.text((cx, cy-22), f'b{b} apt{a} {t}', fill='red')
            M.save(f'qa_montage_b{b}.png')
            print('montage b', b)
