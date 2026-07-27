import { useEffect, useMemo, useState } from 'react';
import { APARTMENTS } from './data.js';
import RESEARCH from './apartmentResearch.json';
import {
  CALIBRATION_DATE,
  DEFAULT_SALE_DATE,
  MARKET_DEFAULTS,
  MARKET_LABELS,
  PERCENT_KEYS,
  fullModel,
  nis,
  pct,
} from './marketModel.js';

const RESEARCH_BY_ID = new Map(RESEARCH.units.map((unit) => [unit.apartment_id, unit]));
const DIR_HE = { full: 'מלא', partial: 'חלקי', '': 'לא' };
const fmtDate = (date) => date.toLocaleDateString('he-IL', { month: '2-digit', year: 'numeric' });
const fmtFullDate = (date) => date.toLocaleDateString('he-IL');
const PROFIT_TIE_BAND_ILS = 25000;

const ASSUMPTION_GROUPS = [
  {
    title: 'מחיר הרכישה',
    keys: ['pricePerM2', 'balconyCoef', 'vat', 'discountRate', 'discountCap'],
  },
  {
    title: 'מדד תשומות הבנייה',
    keys: ['indexAnnual', 'indexedShareAfterFirst20'],
  },
  {
    title: 'שווי שוק כיום',
    keys: ['compact3Rate', 'large3Rate', 'fourRoomRate', 'garden1Premium', 'garden2Premium'],
  },
  {
    title: 'תרחישים עד המכירה',
    keys: ['downsideGrowthAnnual', 'baseGrowthAnnual', 'upsideGrowthAnnual', 'marketCalibrationRange'],
  },
];

function usePersistent(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

function priorityGroup(rank) {
  if (rank <= 10) return 'A';
  if (rank <= 25) return 'B';
  if (rank <= 50) return 'C';
  return 'D';
}

function rankConfidence(row) {
  const spread = row.worstRank - row.bestRank;
  if (spread <= 1) return 'יציב מאוד';
  if (spread <= 4) return 'יציב';
  if (spread <= 8) return 'בינוני';
  return 'רגיש להנחות';
}

function compareQuality(a, b, key) {
  const qualityDiff = (b.qualityAdjustmentPct ?? 0) - (a.qualityAdjustmentPct ?? 0);
  if (qualityDiff !== 0) return qualityDiff;
  const locationDiff = (b.locationScore ?? 0) - (a.locationScore ?? 0);
  if (locationDiff !== 0) return locationDiff;
  const planDiff = (b.planScore ?? 0) - (a.planScore ?? 0);
  if (planDiff !== 0) return planDiff;
  return b[key] - a[key];
}

function createRankMap(rows, key) {
  const profitSorted = [...rows]
    .filter((row) => row.prog)
    .sort((a, b) => b[key] - a[key]);
  const ranked = [];

  for (let index = 0; index < profitSorted.length;) {
    const groupStartValue = profitSorted[index][key];
    const group = [];
    while (
      index < profitSorted.length
      && groupStartValue - profitSorted[index][key] <= PROFIT_TIE_BAND_ILS
    ) {
      group.push(profitSorted[index]);
      index += 1;
    }
    group.sort((a, b) => compareQuality(a, b, key));
    ranked.push(...group);
  }

  return new Map(ranked.map((row, index) => [row.id, index + 1]));
}

function applyRanks(rows) {
  const baseRanks = createRankMap(rows, 'profit');
  const lowRanks = createRankMap(rows, 'lowProfit');
  const highRanks = createRankMap(rows, 'highProfit');
  rows.forEach((row) => {
    if (!row.prog) return;
    row.rank = baseRanks.get(row.id);
    row.lowRank = lowRanks.get(row.id);
    row.highRank = highRanks.get(row.id);
    row.bestRank = Math.min(row.rank, row.lowRank, row.highRank);
    row.worstRank = Math.max(row.rank, row.lowRank, row.highRank);
    row.priority = priorityGroup(row.rank);
    row.rankConfidence = rankConfidence(row);
  });
  return rows;
}

export default function App() {
  const [assumptions, setAssumptions] = usePersistent('assumptions-v2', MARKET_DEFAULTS);
  const [taken, setTaken] = usePersistent('taken-v1', []);
  const [showAll, setShowAll] = useState(false);
  const [selectionMode, setSelectionMode] = usePersistent('selmode-v1', false);
  const [filters, setFilters] = useState({ building: 0, rooms: 0, park: false, hideTaken: false, priority: '' });
  const [sort, setSort] = useState({ key: 'rank', dir: 1 });
  const [detail, setDetail] = useState(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const a = { ...MARKET_DEFAULTS, ...assumptions };
  const takenSet = useMemo(() => new Set(taken), [taken]);

  const allRows = useMemo(() => {
    const modeled = APARTMENTS.map((apt) => {
      const id = `${apt.b}-${apt.apt}`;
      const research = RESEARCH_BY_ID.get(id) ?? null;
      return {
        ...apt,
        ...fullModel(apt, research, a),
        research,
        id,
        planScore: research?.plan_score ?? null,
        locationScore: research?.location_score ?? null,
        qualityAdjustmentPct: research?.total_quality_adjustment_pct ?? 0,
      };
    });
    return applyRanks(modeled);
  }, [a]);

  const rows = useMemo(() => {
    let list = allRows.filter((row) => showAll || row.prog);
    if (filters.building) list = list.filter((row) => row.b === filters.building);
    if (filters.rooms) list = list.filter((row) => Math.round(row.rooms) === filters.rooms);
    if (filters.park) list = list.filter((row) => row.park);
    if (filters.priority) list = list.filter((row) => row.priority === filters.priority);
    if (filters.hideTaken) list = list.filter((row) => !takenSet.has(row.id));
    list.sort((x, y) => {
      const xv = x[sort.key] ?? -Infinity;
      const yv = y[sort.key] ?? -Infinity;
      return (xv > yv ? 1 : xv < yv ? -1 : 0) * sort.dir;
    });
    return list;
  }, [allRows, filters, showAll, sort, takenSet]);

  const bestRemaining = useMemo(
    () => allRows
      .filter((row) => row.prog && !takenSet.has(row.id))
      .sort((x, y) => x.rank - y.rank)[0],
    [allRows, takenSet],
  );

  const topThree = useMemo(
    () => allRows.filter((row) => row.prog).sort((x, y) => x.rank - y.rank).slice(0, 3),
    [allRows],
  );

  const toggleTaken = (id) => setTaken((current) => (
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  ));

  const th = (key, label) => (
    <th
      onClick={() => setSort((current) => ({ key, dir: current.key === key ? -current.dir : -1 }))}
      className={sort.key === key ? 'sorted' : ''}
    >
      {label}{sort.key === key ? (sort.dir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <div className="app">
      <header>
        <div>
          <h1>אדרת בצמרת — בחירת דירה לפי רווח צפוי</h1>
          <div className="sub">
            84 דירות מחיר מטרה · מסירה משוערת 10/2029 · מכירה אפשרית משוערת 05/2030
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

      <section className="model-banner">
        <div>
          <b>מודל בסיס:</b> שווי לפי סגמנט וגודל אפקטיבי, התאמת תכנון ומיקום, וצמיחה של {pct(a.baseGrowthAnnual)} לשנה עד {fmtDate(DEFAULT_SALE_DATE)}.
        </div>
        <div>
          הכיול שמרני ונכון ל־{fmtFullDate(CALIBRATION_DATE)}. פער רווח של עד {nis(PROFIT_TIE_BAND_ILS)} נחשב לאותו טווח פיננסי, ובתוכו איכות הדירה שוברת את השוויון.
        </div>
      </section>

      <section className="top-cards">
        {topThree.map((row) => (
          <button key={row.id} className="top-card" onClick={() => setDetail(row)}>
            <span className="top-rank">#{row.rank}</span>
            <b>בניין {row.b}, דירה {row.apt}</b>
            <span>{row.segment} · קומה {row.floor}</span>
            <strong>{nis(row.profit)}</strong>
            <small>{nis(row.lowProfit)}–{nis(row.highProfit)}</small>
          </button>
        ))}
      </section>

      {selectionMode && (
        <div className="selection-bar">
          נלקחו: {taken.length} · נותרו: {84 - taken.length}
          {bestRemaining && (
            <span>
              · הטובה ביותר שנותרה: <b>בניין {bestRemaining.b}, דירה {bestRemaining.apt}</b>
              {' '}— רווח בסיס {nis(bestRemaining.profit)}
            </span>
          )}
          {taken.length > 0 && <button onClick={() => setTaken([])}>איפוס</button>}
        </div>
      )}

      <div className="layout">
        <aside className={showAssumptions ? '' : 'collapsed'}>
          <h2 onClick={() => setShowAssumptions(!showAssumptions)}>
            הנחות המודל {showAssumptions ? '▾' : '◂'}
          </h2>
          {!showAssumptions && <div className="aside-summary">לחצו לפתיחת ההנחות והתרחישים</div>}
          {showAssumptions && (
            <>
              {ASSUMPTION_GROUPS.map((group) => (
                <div className="assumption-group" key={group.title}>
                  <h3>{group.title}</h3>
                  {group.keys.map((key) => (
                    <label key={key} className="assump">
                      <span>{MARKET_LABELS[key]}</span>
                      <input
                        type="number"
                        step={PERCENT_KEYS.has(key) ? 0.1 : 100}
                        value={PERCENT_KEYS.has(key) ? +(a[key] * 100).toFixed(2) : a[key]}
                        onChange={(e) => {
                          const value = Number.parseFloat(e.target.value);
                          if (Number.isNaN(value)) return;
                          setAssumptions({ ...a, [key]: PERCENT_KEYS.has(key) ? value / 100 : value });
                        }}
                      />
                      {PERCENT_KEYS.has(key) && <em>%</em>}
                    </label>
                  ))}
                </div>
              ))}
              <button className="reset" onClick={() => setAssumptions(MARKET_DEFAULTS)}>איפוס לברירת המחדל</button>
              <div className="note">
                לפי ברירת המחדל, 20% הראשונים אינם מוצמדים ורק {pct(a.indexedShareAfterFirst20, 0)} מכל תשלום מאוחר יותר צמוד למדד.
              </div>
              <div className="note warn">
                פרמיות החצר זמניות עד לקבלת תשריט הצמדות ושטח חצר חוזי. חניה, מחסן, מימון ומסי מכירה עדיין אינם נכללים.
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
            <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
              <option value="">כל קבוצות העדיפות</option>
              <option value="A">A — 10 המובילות</option>
              <option value="B">B — מקומות 11–25</option>
              <option value="C">C — מקומות 26–50</option>
              <option value="D">D — יתר הדירות</option>
            </select>
            <label className="toggle"><input type="checkbox" checked={filters.park} onChange={(e) => setFilters({ ...filters, park: e.target.checked })} /> רק פארק</label>
            {selectionMode && <label className="toggle"><input type="checkbox" checked={filters.hideTaken} onChange={(e) => setFilters({ ...filters, hideTaken: e.target.checked })} /> הסתר שנלקחו</label>}
            <span className="count">{rows.length} דירות</span>
          </div>

          <table>
            <thead>
              <tr>
                {selectionMode && <th>נלקחה</th>}
                {th('rank', 'דירוג')}
                {th('priority', 'קבוצה')}
                {th('b', 'בניין')}
                {th('apt', 'דירה')}
                {th('floor', 'קומה')}
                {th('type', 'טיפוס')}
                {th('rooms', 'חד׳')}
                {th('area', 'שטח')}
                {th('bal', 'מרפסת')}
                <th>כיוונים</th>
                <th>פארק</th>
                {th('totalCost', 'עלות')}
                {th('marketValue', 'שווי 05/30')}
                {th('profit', 'רווח בסיס')}
                <th>טווח רווח</th>
                {th('qualityAdjustmentPct', 'התאמת איכות')}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={[
                    takenSet.has(row.id) ? 'taken' : '',
                    row.prog ? '' : 'free-market',
                    bestRemaining?.id === row.id && selectionMode ? 'best' : '',
                  ].join(' ')}
                  onClick={() => setDetail(row)}
                >
                  {selectionMode && (
                    <td onClick={(e) => { e.stopPropagation(); toggleTaken(row.id); }}>
                      <input type="checkbox" readOnly checked={takenSet.has(row.id)} />
                    </td>
                  )}
                  <td>{row.rank ?? '—'}</td>
                  <td>{row.priority ? <span className={`priority priority-${row.priority}`}>{row.priority}</span> : '—'}</td>
                  <td>{row.b}</td>
                  <td><b>{row.apt}</b></td>
                  <td>{row.floor === 0 ? 'קרקע' : row.floor}</td>
                  <td>{row.type}</td>
                  <td>{Math.round(row.rooms)}</td>
                  <td>{row.area.toFixed(1)}</td>
                  <td>{row.bal ? `${row.bal.toFixed(1)}${row.nBal > 1 ? ` (×${row.nBal})` : ''}` : row.yard ? 'חצר' : '—'}</td>
                  <td>{row.dir}</td>
                  <td>{DIR_HE[row.park]}</td>
                  <td>{row.prog ? nis(row.totalCost) : '—'}</td>
                  <td>{nis(row.marketValue)}</td>
                  <td className={row.prog ? 'profit' : ''}>{row.prog ? nis(row.profit) : '—'}</td>
                  <td className="range">{row.prog ? `${nis(row.lowProfit)}–${nis(row.highProfit)}` : '—'}</td>
                  <td className="quality">{row.research ? `${row.qualityAdjustmentPct > 0 ? '+' : ''}${row.qualityAdjustmentPct.toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </div>

      {detail && (
        <Detail
          apt={rows.find((row) => row.id === detail.id) ?? detail}
          rows={rows}
          assumptions={a}
          onClose={() => setDetail(null)}
          onNavigate={setDetail}
        />
      )}

      <footer>
        המודל הוא כלי החלטה ולא שומת מקרקעין חתומה. שווי השוק מבוסס על כיול שמרני לעסקאות ופרויקטים חדשים בפתח תקווה ביולי 2026 ועל תרחישים עד מאי 2030. הרווח המוצג הוא גולמי ואינו כולל מימון, תיווך, עו״ד או מס.
      </footer>
    </div>
  );
}

function Detail({ apt, rows, assumptions, onClose, onNavigate }) {
  const index = rows.findIndex((row) => row.id === apt.id);
  const previous = index > 0 ? rows[index - 1] : null;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null;

  useEffect(() => {
    const onKey = (event) => {
      if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowUp' && previous) { event.preventDefault(); onNavigate(previous); }
      if (event.key === 'ArrowDown' && next) { event.preventDefault(); onNavigate(next); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previous, next, onNavigate]);

  const research = apt.research;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        <div className="drawer-nav">
          <button disabled={!previous} onClick={() => previous && onNavigate(previous)}>▲ הקודמת</button>
          <span className="drawer-nav-pos">{index + 1} מתוך {rows.length}</span>
          <button disabled={!next} onClick={() => next && onNavigate(next)}>הבאה ▼</button>
        </div>

        <div className="detail-title">
          <div>
            <h2>בניין {apt.b} · דירה {apt.apt}</h2>
            <div className="detail-sub">{apt.segment} · טיפוס {apt.type} · קומה {apt.floor === 0 ? 'קרקע' : apt.floor}</div>
          </div>
          {apt.priority && <span className={`priority priority-${apt.priority} priority-large`}>{apt.priority}</span>}
        </div>

        <div className="grid">
          <div><span>דירוג רווח</span><b>#{apt.rank ?? '—'}</b></div>
          <div><span>יציבות דירוג</span><b>{apt.rankConfidence ?? '—'}</b></div>
          <div><span>טווח דירוג בתרחישים</span><b>{apt.bestRank ?? '—'}–{apt.worstRank ?? '—'}</b></div>
          <div><span>שטח דירה</span><b>{apt.area.toFixed(2)} מ״ר</b></div>
          <div><span>מרפסת/חצר</span><b>{apt.bal ? `${apt.bal.toFixed(2)} מ״ר` : apt.yard ? 'חצר פרטית' : '—'}</b></div>
          <div><span>כיוונים</span><b>{apt.dir}</b></div>
          <div><span>נוף לפארק</span><b>{DIR_HE[apt.park]}</b></div>
          {research && <div><span>ציון תכנון</span><b>{research.plan_score}/100</b></div>}
          {research && <div><span>ציון מיקום</span><b>{research.location_score.toFixed(1)}/100</b></div>}
          {research && <div><span>התאמת איכות</span><b>{research.total_quality_adjustment_pct > 0 ? '+' : ''}{research.total_quality_adjustment_pct.toFixed(2)}%</b></div>}
        </div>

        {apt.prog && (
          <>
            <h3>שווי ורווח</h3>
            <table className="mini valuation-table">
              <tbody>
                <tr><td>שטח שוק אפקטיבי</td><td>{apt.effectiveMarketArea.toFixed(2)} מ״ר</td></tr>
                <tr><td>מחיר כיול בסגמנט כיום</td><td>{nis(apt.currentRate)} למ״ר אפקטיבי</td></tr>
                <tr><td>שווי לפני התאמת איכות כיום</td><td>{nis(apt.currentUnadjustedValue)}</td></tr>
                <tr><td>התאמת תכנון ומיקום</td><td>{apt.qualityAdjustment > 0 ? '+' : ''}{pct(apt.qualityAdjustment, 2)}</td></tr>
                <tr><td>שווי משוער כיום</td><td>{nis(apt.currentMarketValue)}</td></tr>
                <tr><td>תרחיש בסיס עד 05/2030</td><td>{pct(assumptions.baseGrowthAnnual)} לשנה</td></tr>
                <tr className="hl"><td>שווי מכירה משוער — בסיס</td><td>{nis(apt.marketValue)}</td></tr>
                <tr><td>טווח שווי נמוך–גבוה</td><td>{nis(apt.lowMarketValue)}–{nis(apt.highMarketValue)}</td></tr>
                <tr><td>מחיר חוזי נטו</td><td>{nis(apt.netPrice)}</td></tr>
                <tr><td>תוספת מדד משוערת</td><td>+{nis(apt.indexAddition)}</td></tr>
                <tr className="hl"><td>עלות רכישה כוללת</td><td>{nis(apt.totalCost)}</td></tr>
                <tr className="hl profit"><td>רווח גולמי משוער — בסיס</td><td>{nis(apt.profit)}</td></tr>
                <tr><td>טווח רווח</td><td>{nis(apt.lowProfit)}–{nis(apt.highProfit)}</td></tr>
                <tr><td>תשואה על העלות</td><td>{pct(apt.roi)}</td></tr>
              </tbody>
            </table>

            <h3>לוח תשלומים ומדד</h3>
            <div className="note">
              20% הראשונים אינם מוצמדים. לאחר מכן רק החלק שהוגדר בהנחות מוצמד למדד; ברירת המחדל היא 50% מכל תשלום.
            </div>
            <table className="mini">
              <thead><tr><th>מועד</th><th>%</th><th>נומינלי</th><th>חלק צמוד</th><th>צפוי בפועל</th><th>מצטבר</th></tr></thead>
              <tbody>
                {apt.payments.map((payment, paymentIndex) => (
                  <tr key={paymentIndex}>
                    <td>{fmtDate(payment.date)}</td>
                    <td>{pct(payment.pct, 0)}</td>
                    <td>{nis(payment.nominal)}</td>
                    <td>{pct(payment.indexedShare, 0)}</td>
                    <td>{nis(payment.actual)}</td>
                    <td>{nis(payment.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {research && <DeepResearch research={research} />}

        <h3>תוכנית הדירה</h3>
        <PlanImage apt={apt} />
        <div className="note">מקור: תוכניות המכר (DWFX) · לחיצה מגדילה · יש לאמת מידות והצמדות מול תוכנית המכר החתומה.</div>
      </div>
    </div>
  );
}

function TextList({ value, className = '' }) {
  if (!value) return <div>—</div>;
  const items = value.split('|').map((item) => item.trim()).filter(Boolean);
  if (items.length <= 1) return <div className={className}>{value}</div>;
  return <ul className={className}>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}

function DeepResearch({ research }) {
  return (
    <section className="deep-review">
      <h3>ניתוח שמאי־תכנוני</h3>
      <p className="review-summary">{research.plan_summary}</p>
      <div className="research-score-grid">
        <div><span>חלל ציבורי</span><b>{research.public_space_score}</b></div>
        <div><span>חדרי שינה</span><b>{research.bedrooms_score}</b></div>
        <div><span>יעילות שטח</span><b>{research.efficiency_score}</b></div>
        <div><span>רחצה ושירות</span><b>{research.service_score}</b></div>
        <div><span>גמישות</span><b>{research.flexibility_score}</b></div>
      </div>

      <ReviewBlock title="מידות מרכזיות" text={research.dimensions} />
      <ReviewBlock title="סלון, מטבח ופינת אוכל" text={research.public_notes} />
      <ReviewBlock title="חדרי שינה ואזור פרטי" text={research.bedroom_notes} />
      <ReviewBlock title="תנועה וניצול שטח" text={research.circulation_notes} />
      <ReviewBlock title="רחצה, שירות וכביסה" text={research.service_notes} />
      <ReviewBlock title="מרפסת או חצר" text={research.outdoor_notes} />
      <ReviewBlock title="כיוון ואור" text={research.orientation_note} />
      <ReviewBlock title="קומה ופרטיות" text={research.floor_note} />
      <ReviewBlock title="מיקרו־מיקום" text={research.micro_location_note} />

      <div className="rv-cols">
        <div>
          <b>חוזקות היחידה</b>
          <TextList value={research.unit_strengths} />
        </div>
        <div>
          <b>סיכונים וחסרונות</b>
          <TextList value={research.unit_risks} className="cons" />
        </div>
      </div>
      <div className="verification-box">
        <b>מה חייבים לאמת לפני הבחירה</b>
        <TextList value={research.verification_needed} />
      </div>
    </section>
  );
}

function ReviewBlock({ title, text }) {
  return (
    <div className="review-block">
      <b>{title}</b>
      <p>{text || '—'}</p>
    </div>
  );
}

function PlanImage({ apt }) {
  const [zoomed, setZoomed] = useState(false);
  const src = `${import.meta.env.BASE_URL}plans/apt_b${apt.b}_${apt.apt}.png`;

  useEffect(() => {
    if (!zoomed) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  return (
    <>
      <img
        className="plan-img"
        src={src}
        alt={`תוכנית דירה ${apt.apt} בניין ${apt.b}`}
        onClick={() => setZoomed(true)}
        onError={(event) => { event.currentTarget.style.display = 'none'; }}
      />
      {zoomed && (
        <div className="plan-lightbox" onClick={() => setZoomed(false)}>
          <button className="close" onClick={() => setZoomed(false)}>✕</button>
          <img src={src} alt={`תוכנית דירה ${apt.apt} בניין ${apt.b}`} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
