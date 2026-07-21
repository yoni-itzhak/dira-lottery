import { useEffect, useMemo, useState } from 'react';
import { APARTMENTS } from './data.js';
import { getReview, floorNote } from './reviews.js';

// ---- payment schedule (user's terms): 7% at signing, 13% after 1.5m, then 10% every 4.5m ----
const SIGN_DATE = new Date(2026, 8, 1); // Sep 1, 2026
const SCHEDULE = [
  { pct: 0.07, months: 0 },
  { pct: 0.13, months: 1.5 },
  ...Array.from({ length: 8 }, (_, i) => ({ pct: 0.10, months: 1.5 + 4.5 * (i + 1) })),
];

const DEFAULTS = {
  pricePerM2: 15022,      // ₪/m² before VAT (tender)
  balconyCoef: 0.30,      // balcony weight in contract pricing
  vat: 0.18,
  discountRate: 0.20,
  discountCap: 300000,
  indexAnnual: 0.03,      // מדד תשומות הבנייה, annual assumption
  marketPerM2: 24000,     // ₪/m² incl. VAT at sale — UPDATE from real data
  marketBalconyCoef: 0.5,
  floorPremiumPct: 0.008, // market premium per floor
  parkBonus: 0.05,        // full park view bonus on market value
  parkPartial: 0.02,
  smallBalconyPenalty: 0.015, // balcony < 10m²
  yardBonus: 0.03,
};

const LABELS = {
  pricePerM2: 'מחיר למ"ר לפני מע"מ (מכרז)',
  balconyCoef: 'מקדם מרפסת בחוזה',
  vat: 'מע"מ',
  discountRate: 'שיעור הנחה',
  discountCap: 'תקרת הנחה (₪)',
  indexAnnual: 'מדד תשומות בנייה שנתי',
  marketPerM2: 'מחיר שוק למ"ר (כולל מע"מ)',
  marketBalconyCoef: 'מקדם מרפסת בשווי שוק',
  floorPremiumPct: 'פרמיית קומה (לשוק, לקומה)',
  parkBonus: 'בונוס נוף לפארק (מלא)',
  parkPartial: 'בונוס נוף לפארק (חלקי)',
  smallBalconyPenalty: 'קנס מרפסת קטנה (<10 מ"ר)',
  yardBonus: 'בונוס חצר (דירת גן)',
};
const PCT_KEYS = new Set(['balconyCoef','vat','discountRate','indexAnnual','marketBalconyCoef','floorPremiumPct','parkBonus','parkPartial','smallBalconyPenalty','yardBonus']);

const nis = (v) => '₪' + Math.round(v).toLocaleString('he-IL');
const fmtDate = (d) => d.toLocaleDateString('he-IL', { month: '2-digit', year: 'numeric' });

function addMonths(date, m) {
  const d = new Date(date);
  const whole = Math.floor(m);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round((m - whole) * 30));
  return d;
}

// indexation multiplier for total contract: Σ pct·(1+idx)^(months/12)
function indexFactor(a) {
  return SCHEDULE.reduce((s, p) => s + p.pct * Math.pow(1 + a.indexAnnual, p.months / 12), 0);
}

export function priceModel(apt, a) {
  const pricingArea = apt.area + a.balconyCoef * apt.bal;
  const priceExVat = pricingArea * a.pricePerM2;
  const priceIncVat = priceExVat * (1 + a.vat);
  const discount = Math.min(a.discountRate * priceIncVat, a.discountCap);
  const netPrice = priceIncVat - discount;
  const idxFactor = indexFactor(a);
  const totalCost = netPrice * idxFactor;

  let marketMult = 1 + a.floorPremiumPct * apt.floor;
  if (apt.park === 'full') marketMult *= 1 + a.parkBonus;
  else if (apt.park === 'partial') marketMult *= 1 + a.parkPartial;
  if (apt.bal > 0 && apt.bal < 10) marketMult *= 1 - a.smallBalconyPenalty;
  if (apt.yard) marketMult *= 1 + a.yardBonus;
  const marketValue = a.marketPerM2 * (apt.area + a.marketBalconyCoef * apt.bal) * marketMult;

  return { pricingArea, priceExVat, priceIncVat, discount, netPrice, idxFactor, totalCost, marketValue, profit: marketValue - totalCost };
}

function usePersistent(key, initial) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; }
    catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(val)); }, [key, val]);
  return [val, setVal];
}

const DIR_HE = { full: 'מלא', partial: 'חלקי', '': '' };

export default function App() {
  const [assump, setAssump] = usePersistent('assumptions-v1', DEFAULTS);
  const [taken, setTaken] = usePersistent('taken-v1', []);
  const [showAll, setShowAll] = useState(false);
  const [selectionMode, setSelectionMode] = usePersistent('selmode-v1', false);
  const [filters, setFilters] = useState({ building: 0, rooms: 0, park: false, hideTaken: false });
  const [sort, setSort] = useState({ key: 'profit', dir: -1 });
  const [detail, setDetail] = useState(null);
  const [showAssump, setShowAssump] = useState(true);

  const a = { ...DEFAULTS, ...assump };
  const takenSet = useMemo(() => new Set(taken), [taken]);

  const rows = useMemo(() => {
    let list = APARTMENTS.filter((x) => showAll || x.prog).map((apt) => ({ ...apt, ...priceModel(apt, a), id: `${apt.b}-${apt.apt}`, design: getReview(apt)?.score ?? null }));
    const progRanked = [...list].filter((r) => r.prog).sort((x, y) => y.profit - x.profit);
    const rankMap = new Map(progRanked.map((r, i) => [r.id, i + 1]));
    list.forEach((r) => { r.rank = rankMap.get(r.id) ?? null; });
    if (filters.building) list = list.filter((r) => r.b === filters.building);
    if (filters.rooms) list = list.filter((r) => Math.round(r.rooms) === filters.rooms);
    if (filters.park) list = list.filter((r) => r.park);
    if (filters.hideTaken) list = list.filter((r) => !takenSet.has(r.id));
    list.sort((x, y) => {
      const k = sort.key;
      const xv = x[k] ?? -Infinity, yv = y[k] ?? -Infinity;
      return (xv > yv ? 1 : xv < yv ? -1 : 0) * sort.dir;
    });
    return list;
  }, [a, filters, sort, showAll, takenSet]);

  const bestRemaining = useMemo(
    () => rows.filter((r) => r.prog && !takenSet.has(r.id)).sort((x, y) => y.profit - x.profit)[0],
    [rows, takenSet]
  );

  const toggleTaken = (id) =>
    setTaken((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const th = (key, label) => (
    <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}
        className={sort.key === key ? 'sorted' : ''}>
      {label}{sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <div className="app">
      <header>
        <div>
          <h1>אדרת בצמרת — סירקין 201</h1>
          <div className="sub">
            מחיר מטרה · 84 דירות · מקומכם בבחירה: 60 ·
            מסירה משוערת ~10/2029 · מכירה מותרת ~05/2030 (7 שנים מהזכייה)
          </div>
        </div>
        <div className="header-actions">
          <label className="toggle">
            <input type="checkbox" checked={selectionMode} onChange={(e) => setSelectionMode(e.target.checked)} />
            מצב יום הבחירה
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            הצג גם שוק חופשי
          </label>
        </div>
      </header>

      {selectionMode && (
        <div className="selection-bar">
          נלקחו: {taken.length} · נותרו: {84 - taken.length}
          {bestRemaining && (
            <span> · הטובה ביותר שנותרה: <b>בניין {bestRemaining.b} דירה {bestRemaining.apt}</b> ({bestRemaining.type}, קומה {bestRemaining.floor}, רווח {nis(bestRemaining.profit)})</span>
          )}
          {taken.length > 0 && <button onClick={() => setTaken([])}>איפוס</button>}
        </div>
      )}

      <div className="layout">
        <aside className={showAssump ? '' : 'collapsed'}>
          <h2 onClick={() => setShowAssump(!showAssump)}>הנחות המודל {showAssump ? '▾' : '◂'}</h2>
          {showAssump && (
            <>
              {Object.keys(LABELS).map((k) => (
                <label key={k} className="assump">
                  <span>{LABELS[k]}</span>
                  <input
                    type="number"
                    step={PCT_KEYS.has(k) ? 0.1 : 100}
                    value={PCT_KEYS.has(k) ? +(a[k] * 100).toFixed(2) : a[k]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isNaN(v)) return;
                      setAssump({ ...a, [k]: PCT_KEYS.has(k) ? v / 100 : v });
                    }}
                  />
                  {PCT_KEYS.has(k) && <em>%</em>}
                </label>
              ))}
              <button className="reset" onClick={() => setAssump(DEFAULTS)}>אפס לברירת מחדל</button>
              <div className="note">
                מקדם ההצמדה למדד לפי לוח התשלומים (7% / 13% / 8×10%):
                ×{indexFactor(a).toFixed(4)}
              </div>
              <div className="note warn">
                לאימות מול החוזה: מקדם המרפסת בתמחור, צד הפארק (מזרח, בניינים 2-3),
                ומחיר השוק למ"ר.
              </div>
            </>
          )}
        </aside>

        <main>
          <div className="filters">
            <select value={filters.building} onChange={(e) => setFilters({ ...filters, building: +e.target.value })}>
              <option value={0}>כל הבניינים</option>
              <option value={1}>בניין 1</option>
              <option value={2}>בניין 2</option>
              <option value={3}>בניין 3</option>
            </select>
            <select value={filters.rooms} onChange={(e) => setFilters({ ...filters, rooms: +e.target.value })}>
              <option value={0}>כל החדרים</option>
              <option value={3}>3 חדרים</option>
              <option value={4}>4 חדרים</option>
            </select>
            <label className="toggle"><input type="checkbox" checked={filters.park} onChange={(e) => setFilters({ ...filters, park: e.target.checked })} /> רק פונות לפארק</label>
            {selectionMode && <label className="toggle"><input type="checkbox" checked={filters.hideTaken} onChange={(e) => setFilters({ ...filters, hideTaken: e.target.checked })} /> הסתר שנלקחו</label>}
            <span className="count">{rows.length} דירות</span>
          </div>

          <table>
            <thead>
              <tr>
                {selectionMode && <th>נלקחה</th>}
                {th('rank', 'דירוג')}
                {th('b', 'בניין')}
                {th('apt', 'דירה')}
                {th('floor', 'קומה')}
                {th('type', 'טיפוס')}
                {th('rooms', 'חד׳')}
                {th('area', 'שטח')}
                {th('bal', 'מרפסת')}
                <th>כיוונים</th>
                <th>פארק</th>
                {th('totalCost', 'עלות כוללת')}
                {th('marketValue', 'שווי שוק')}
                {th('profit', 'רווח')}
                {th('design', 'תכנון')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}
                    className={[takenSet.has(r.id) ? 'taken' : '', r.prog ? '' : 'free-market', bestRemaining?.id === r.id && selectionMode ? 'best' : ''].join(' ')}
                    onClick={() => setDetail(r)}>
                  {selectionMode && (
                    <td onClick={(e) => { e.stopPropagation(); toggleTaken(r.id); }}>
                      <input type="checkbox" readOnly checked={takenSet.has(r.id)} />
                    </td>
                  )}
                  <td>{r.rank ?? '—'}</td>
                  <td>{r.b}</td>
                  <td><b>{r.apt}</b></td>
                  <td>{r.floor === 0 ? 'קרקע' : r.floor}</td>
                  <td>{r.type}</td>
                  <td>{Math.round(r.rooms)}</td>
                  <td>{r.area.toFixed(1)}</td>
                  <td>{r.bal ? r.bal.toFixed(1) + (r.nBal > 1 ? ` (×${r.nBal})` : '') : r.yard ? 'חצר' : '—'}</td>
                  <td>{r.dir}</td>
                  <td>{DIR_HE[r.park]}</td>
                  <td>{r.prog ? nis(r.totalCost) : '—'}</td>
                  <td>{nis(r.marketValue)}</td>
                  <td className={r.prog ? 'profit' : ''}>{r.prog ? nis(r.profit) : '—'}</td>
                  <td className='design'>{r.design ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </div>

      {detail && <Detail apt={detail} a={a} onClose={() => setDetail(null)} />}

      <footer>
        הנתונים חולצו אוטומטית מתכניות המכר (DWFX). מחירי השוק והמדד הם הערכות —
        עדכנו את ההנחות. אין לראות בכך ייעוץ השקעות.
      </footer>
    </div>
  );
}

function Detail({ apt, a, onClose }) {
  const m = priceModel(apt, a);
  let paid = 0;
  const sched = SCHEDULE.map((p) => {
    const date = addMonths(SIGN_DATE, p.months);
    const nominal = m.netPrice * p.pct;
    const indexed = nominal * Math.pow(1 + a.indexAnnual, p.months / 12);
    paid += indexed;
    return { date, pct: p.pct, nominal, indexed, cum: paid };
  });
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        <h2>בניין {apt.b} · דירה {apt.apt} {apt.prog ? '· מחיר מטרה' : '· שוק חופשי'}</h2>
        <div className="grid">
          <div><span>קומה</span><b>{apt.floor === 0 ? 'קרקע' : apt.floor}</b></div>
          <div><span>טיפוס</span><b>{apt.type}</b></div>
          <div><span>חדרים</span><b>{Math.round(apt.rooms)}</b></div>
          <div><span>שטח דירה</span><b>{apt.area.toFixed(2)} מ"ר</b></div>
          <div><span>מרפסת שמש</span><b>{apt.bal ? `${apt.bal.toFixed(2)} מ"ר${apt.nBal > 1 ? ` (${apt.nBal} מרפסות)` : ''}` : apt.yard ? 'חצר פרטית' : '—'}</b></div>
          <div><span>כיווני אוויר</span><b>{apt.dir}</b></div>
          <div><span>נוף לפארק</span><b>{DIR_HE[apt.park] || 'לא'}</b></div>
          {apt.cap && <div><span>תקרת מחיר מטרה</span><b>עד {apt.cap} מ"ר</b></div>}
        </div>

        {apt.prog && (
          <>
            <h3>תחשיב מחיר</h3>
            <table className="mini">
              <tbody>
                <tr><td>שטח לתמחור ({apt.area.toFixed(1)} + {(a.balconyCoef * 100).toFixed(0)}%×{apt.bal.toFixed(1)})</td><td>{m.pricingArea.toFixed(2)} מ"ר</td></tr>
                <tr><td>מחיר לפני מע"מ</td><td>{nis(m.priceExVat)}</td></tr>
                <tr><td>מחיר כולל מע"מ ({(a.vat * 100).toFixed(0)}%)</td><td>{nis(m.priceIncVat)}</td></tr>
                <tr><td>הנחה (מינ׳ {(a.discountRate * 100).toFixed(0)}% / {nis(a.discountCap)})</td><td>-{nis(m.discount)}</td></tr>
                <tr className="hl"><td>מחיר חוזי נטו</td><td>{nis(m.netPrice)}</td></tr>
                <tr><td>תוספת הצמדה למדד (×{m.idxFactor.toFixed(4)})</td><td>+{nis(m.totalCost - m.netPrice)}</td></tr>
                <tr className="hl"><td>עלות כוללת משוערת</td><td>{nis(m.totalCost)}</td></tr>
                <tr><td>שווי שוק משוער</td><td>{nis(m.marketValue)}</td></tr>
                <tr className="hl profit"><td>רווח גולמי משוער</td><td>{nis(m.profit)}</td></tr>
              </tbody>
            </table>

            <h3>לוח תשלומים (חתימה 01/09/2026, מדד {(a.indexAnnual * 100).toFixed(1)}% שנתי)</h3>
            <table className="mini">
              <thead><tr><th>מועד</th><th>%</th><th>נומינלי</th><th>צמוד מדד</th><th>מצטבר</th></tr></thead>
              <tbody>
                {sched.map((p, i) => (
                  <tr key={i}>
                    <td>{fmtDate(p.date)}</td>
                    <td>{(p.pct * 100).toFixed(0)}%</td>
                    <td>{nis(p.nominal)}</td>
                    <td>{nis(p.indexed)}</td>
                    <td>{nis(p.cum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <Review apt={apt} />
        <h3>תכנית הדירה</h3>
        <a href={`${import.meta.env.BASE_URL}plans/apt_b${apt.b}_${apt.apt}.png`} target="_blank" rel="noreferrer">
          <img className="plan-img"
               src={`${import.meta.env.BASE_URL}plans/apt_b${apt.b}_${apt.apt}.png`}
               alt={`תכנית דירה ${apt.apt} בניין ${apt.b}`}
               onError={(e) => { e.target.closest('a').style.display = 'none'; }} />
        </a>
        <div className="note">מקור: תכניות המכר (DWFX) · לחיצה פותחת בגודל מלא · בקומות 2-3 מוצגת תכנית הקומה הטיפוסית המשותפת</div>
      </div>
    </div>
  );
}

function Review({ apt }) {
  const rv = getReview(apt);
  if (!rv) return null;
  const notes = floorNote(apt);
  return (
    <div className="review">
      <h3>ביקורת תכנון <span className="score">{rv.score}/10</span></h3>
      <div className="rv-cols">
        <div>
          <b>יתרונות</b>
          <ul>{rv.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
        <div>
          <b>חסרונות</b>
          <ul className="cons">{rv.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      </div>
      <div className="rv-bottom">{rv.bottom}</div>
      {notes.length > 0 && (
        <div className="rv-notes">{notes.map((n, i) => <div key={i}>• {n}</div>)}</div>
      )}
    </div>
  );
}
