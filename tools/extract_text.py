"""Extract positioned, decoded text from DWFx FixedPage files."""
import re, sys, glob, html, os

TAG = re.compile(r'<(/?)(Canvas|Glyphs)((?:[^>"]|"[^"]*")*?)(/?)>')
ATTR = re.compile(r'([\w:.]+)="([^"]*)"')

def mat_mul(a, b):
    # a,b are (m11,m12,m21,m22,dx,dy); returns b applied inside a (a outer)
    return (
        b[0]*a[0] + b[1]*a[2],
        b[0]*a[1] + b[1]*a[3],
        b[2]*a[0] + b[3]*a[2],
        b[2]*a[1] + b[3]*a[3],
        b[4]*a[0] + b[5]*a[2] + a[4],
        b[4]*a[1] + b[5]*a[3] + a[5],
    )

def apply(m, x, y):
    return (x*m[0] + y*m[2] + m[4], x*m[1] + y*m[3] + m[5])

def parse_matrix(s):
    if not s: return (1,0,0,1,0,0)
    s = s.strip()
    if s.lower().startswith('matrix('):
        s = s[7:-1]
    parts = [float(p) for p in re.split(r'[,\s]+', s.strip()) if p]
    return tuple(parts) if len(parts) == 6 else (1,0,0,1,0,0)

def decode_string(s):
    """Decode shifted-font Hebrew (visual order, codepoint-0x550) if present."""
    # chars in U+0080..U+00FF / cp1252 punctuation range that map into Hebrew block
    out = []
    shifted = False
    for ch in s:
        try:
            b = ch.encode('cp1252')[0]
        except (UnicodeEncodeError, IndexError):
            out.append(ch)
            continue
        if 0x80 <= b <= 0xAA and ch not in ' ':
            out.append(chr(b + 0x550))
            shifted = True
        else:
            out.append(ch)
    s2 = ''.join(out)
    if shifted:
        # visual -> logical: reverse whole string, then un-reverse latin/digit runs
        rev = s2[::-1]
        rev = re.sub(r'[A-Za-z0-9\.,/%"\'-]{2,}', lambda m: m.group(0)[::-1], rev)
        return rev
    return s2

def extract(fpage_path):
    d = open(fpage_path, encoding='utf-8', errors='replace').read()
    stack = [(1,0,0,1,0,0)]
    results = []
    for m in TAG.finditer(d):
        closing, name, attrs_s, selfclose = m.groups()
        if name == 'Canvas':
            if closing:
                if len(stack) > 1: stack.pop()
            else:
                a = dict(ATTR.findall(attrs_s))
                mt = mat_mul(stack[-1], parse_matrix(a.get('RenderTransform','')))
                if not selfclose:
                    stack.append(mt)
        elif name == 'Glyphs' and not closing:
            a = dict(ATTR.findall(attrs_s))
            s = html.unescape(a.get('UnicodeString',''))
            if not s.strip(): continue
            mt = mat_mul(stack[-1], parse_matrix(a.get('RenderTransform','')))
            x, y = apply(mt, float(a.get('OriginX',0)), float(a.get('OriginY',0)))
            em = float(a.get('FontRenderingEmSize',0)) * abs(mt[0])
            results.append((x, y, em, decode_string(s)))
    return results

if __name__ == '__main__':
    for path in sys.argv[1:]:
        res = extract(path)
        for x, y, em, s in res:
            print(f'{x:10.2f} {y:10.2f} {em:6.2f}  {s}')
