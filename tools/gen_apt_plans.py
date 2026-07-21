"""Per-apartment plan crops from sheet001_fix.pdf.
Generous per-TYPE frames (verified to contain the full footprint), applied at
each apartment's panel and unioned with that apartment's own info table so the
table always shows the correct apartment number. No overlays."""
import subprocess, os, sys
from build_table import extract

# panel-local (x0,x1) + absolute page (y0,y1). Generous: full footprint + balcony.
TYPE_RECT = {
    '1A': (430, 1420, 320, 1090),
    '1B': (1240, 2140, 320, 1010),
    '1C': (1150, 1975, 900, 1580),
    '1D': (960, 1710, 1090, 1740),
    '1E': (600, 1410, 840, 1490),
    '2A': (2440, 3260, 350, 1060),
    '2B': (3140, 3860, 350, 1050),
    '2C': (3010, 3760, 820, 1470),
    '2D': (2810, 3500, 1000, 1720),
    '2E': (2340, 3120, 800, 1490),
    '3A': (2540, 3260, 1740, 2320),
    '3B': (3250, 4010, 1750, 2320),
    '3C': (3190, 3990, 2290, 2920),
    '3D': (2820, 3600, 2520, 3240),
    '3E': (2540, 3280, 2270, 2800),
}
APT_RECT = {  # garden units are unique layouts
    (3, 1): (2720, 3400, 1770, 2360),
    (3, 2): (2560, 3260, 2350, 2870),
}
TITLES = {'8':12049.87,'7':16112.30,'6':20175.84,'5':24234.53,
          '4':28303.45,'3':32337.67,'2':32337.67,'1':36421.63,'0':40509.83}

def load_apartments():
    apts,_=extract('decoded/03.txt')
    extra={}
    for (b,a),r in list(apts.items()):
        if r['floor']=='H_F00': r['floor']='0'
        if r['floor']=='2-3':
            r2=dict(r); r2['apt']=a+5; r2['floor']='3'; r['floor']='2'; extra[(b,a+5)]=r2
    apts.update(extra); return apts

def crop(x0,y0,x1,y1,out,r=220,pdf='sheet001_fix.pdf'):
    px=0.75*r/72
    subprocess.run(['pdftocairo','-png','-r',str(r),'-x',str(int(x0*px)),'-y',str(int(y0*px)),
        '-W',str(int((x1-x0)*px)),'-H',str(int((y1-y0)*px)),'-singlefile',pdf,out],check=True)

def main(only=None, outdir='plans_out', r=220):
    os.makedirs(outdir, exist_ok=True)
    apts=load_apartments(); made=[]
    for (b,a),rec in sorted(apts.items()):
        if not rec.get('program'): continue
        if only and (b,a) not in only: continue
        rect=APT_RECT.get((b,a)) or TYPE_RECT.get(rec.get('type'))
        if not rect: print('no rect',b,a,rec.get('type')); continue
        lx0,lx1,y0,y1=rect; L=TITLES[rec['floor']]-4062.44
        ax,ay=rec['_x']-L, rec['_y']  # union with this apt's own table
        lx0=min(lx0,ax-95); lx1=max(lx1,ax+85); y0=min(y0,ay-55); y1=max(y1,ay+85)
        out=f'{outdir}/apt_b{b}_{a}'; crop(L+lx0,y0,L+lx1,y1,out,r=r)
        made.append((b,a,rec.get('type'),out+'.png'))
    print(len(made),'crops'); return made

if __name__=='__main__':
    main(outdir='/home/user/dira-lottery/app/public/plans', r=220)
