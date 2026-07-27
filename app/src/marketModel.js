export const SIGN_DATE = new Date(2026, 8, 1);
export const CALIBRATION_DATE = new Date(2026, 6, 26);
export const DEFAULT_SALE_DATE = new Date(2030, 4, 1);

export const SCHEDULE = [
  { pct: 0.07, months: 0 },
  { pct: 0.13, months: 1.5 },
  ...Array.from({ length: 8 }, (_, i) => ({ pct: 0.10, months: 1.5 + 4.5 * (i + 1) })),
];

export const MARKET_DEFAULTS = {
  // Contract/acquisition assumptions
  pricePerM2: 15022,
  balconyCoef: 0.30,
  vat: 0.18,
  discountRate: 0.20,
  discountCap: 300000,
  indexAnnual: 0.03,
  indexedShareAfterFirst20: 0.50,

  // Conservative July 2026 market calibration, per effective market m²
  compact3Rate: 28500,
  large3Rate: 28000,
  fourRoomRate: 27500,

  // Sale-date scenarios (nominal annual change until May 2030)
  downsideGrowthAnnual: -0.01,
  baseGrowthAnnual: 0.015,
  upsideGrowthAnnual: 0.04,
  marketCalibrationRange: 0.05,

  // Provisional garden premiums; intentionally visible and editable
  garden1Premium: 250000,
  garden2Premium: 120000,
};

export const MARKET_LABELS = {
  pricePerM2: 'מחיר למ״ר לפני מע״מ (מכרז)',
  balconyCoef: 'מקדם מרפסת בחוזה',
  vat: 'מע״מ',
  discountRate: 'שיעור ההנחה',
  discountCap: 'תקרת ההנחה (₪)',
  indexAnnual: 'מדד תשומות שנתי צפוי',
  indexedShareAfterFirst20: 'חלק צמוד אחרי 20% ראשונים',
  compact3Rate: 'שוק כיום — 3 חד׳ קומפקטית, למ״ר אפקטיבי',
  large3Rate: 'שוק כיום — 3 חד׳ גדולה, למ״ר אפקטיבי',
  fourRoomRate: 'שוק כיום — 4 חד׳, למ״ר אפקטיבי',
  downsideGrowthAnnual: 'תרחיש נמוך — שינוי שנתי עד המכירה',
  baseGrowthAnnual: 'תרחיש בסיס — שינוי שנתי עד המכירה',
  upsideGrowthAnnual: 'תרחיש גבוה — שינוי שנתי עד המכירה',
  marketCalibrationRange: 'אי־ודאות בכיול השוק',
  garden1Premium: 'פרמיית חצר זמנית — דירה 3-1',
  garden2Premium: 'פרמיית חצר זמנית — דירה 3-2',
};

export const PERCENT_KEYS = new Set([
  'balconyCoef', 'vat', 'discountRate', 'indexAnnual',
  'indexedShareAfterFirst20', 'downsideGrowthAnnual',
  'baseGrowthAnnual', 'upsideGrowthAnnual', 'marketCalibrationRange',
]);

// Based on the measured geometry and usability analysis of each recurring plan.
// This coefficient is only for market valuation of outdoor space; contract pricing
// continues to use balconyCoef above.
export const MARKET_BALCONY_COEFFICIENTS = {
  '1A': 0.30, '1B': 0.32, '1C': 0.55, '1D': 0.50, '1E': 0.50,
  '2A': 0.32, '2B': 0.30, '2C': 0.55, '2D': 0.50, '2E': 0.55,
  '3A': 0.55, '3B': 0.36, '3C': 0.40, '3D': 0.55, '3E': 0.40,
  '3G-1': 0, '3G-2': 0,
};

const CONFIDENCE_MARGIN = {
  'גבוהה': 0.01,
  'בינונית-גבוהה': 0.015,
  'בינונית': 0.025,
  'נמוכה': 0.05,
};

export const nis = (value) => `₪${Math.round(value).toLocaleString('he-IL')}`;
export const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

export function addMonths(date, months) {
  const d = new Date(date);
  const whole = Math.floor(months);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round((months - whole) * 30));
  return d;
}

export function yearsBetween(from, to) {
  return Math.max(0, (to.getTime() - from.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
}

export function inferSegment(apt, research) {
  if (research?.segment) return research.segment;
  if (apt.yard) return 'דירת גן 3 חדרים';
  if (Math.round(apt.rooms) === 4) return '4 חדרים';
  return apt.area >= 84 ? '3 חדרים גדולה' : '3 חדרים קומפקטית';
}

export function segmentRate(segment, assumptions) {
  if (segment === '4 חדרים') return assumptions.fourRoomRate;
  if (segment === '3 חדרים גדולה') return assumptions.large3Rate;
  return assumptions.compact3Rate;
}

export function profileKeyFor(apt, research) {
  if (research?.profile_key) return research.profile_key;
  if (apt.b === 3 && apt.apt === 1) return '3G-1';
  if (apt.b === 3 && apt.apt === 2) return '3G-2';
  return apt.type;
}

export function indexedPaymentAmount(netPrice, payment, index, indexedShare) {
  const nominal = netPrice * payment.pct;
  if (payment.pct === 0.07 || payment.pct === 0.13) return nominal;
  const factor = Math.pow(1 + index, payment.months / 12);
  return nominal * ((1 - indexedShare) + indexedShare * factor);
}

export function acquisitionModel(apt, assumptions) {
  const pricingArea = apt.area + assumptions.balconyCoef * apt.bal;
  const priceExVat = pricingArea * assumptions.pricePerM2;
  const priceIncVat = priceExVat * (1 + assumptions.vat);
  const discount = Math.min(assumptions.discountRate * priceIncVat, assumptions.discountCap);
  const netPrice = priceIncVat - discount;

  const payments = SCHEDULE.map((payment, index) => {
    const nominal = netPrice * payment.pct;
    const indexedShare = index < 2 ? 0 : assumptions.indexedShareAfterFirst20;
    const actual = indexedPaymentAmount(netPrice, payment, assumptions.indexAnnual, indexedShare);
    return {
      ...payment,
      date: addMonths(SIGN_DATE, payment.months),
      nominal,
      indexedShare,
      actual,
      indexAddition: actual - nominal,
    };
  });
  let cumulative = 0;
  payments.forEach((payment) => {
    cumulative += payment.actual;
    payment.cumulative = cumulative;
  });

  return {
    pricingArea,
    priceExVat,
    priceIncVat,
    discount,
    netPrice,
    totalCost: cumulative,
    indexAddition: cumulative - netPrice,
    indexFactor: cumulative / netPrice,
    payments,
  };
}

function gardenPremium(profileKey, assumptions) {
  if (profileKey === '3G-1') return assumptions.garden1Premium;
  if (profileKey === '3G-2') return assumptions.garden2Premium;
  return 0;
}

export function marketModel(apt, research, assumptions) {
  const profileKey = profileKeyFor(apt, research);
  const segment = inferSegment(apt, research);
  const balconyMarketCoef = MARKET_BALCONY_COEFFICIENTS[profileKey] ?? 0.40;
  const effectiveMarketArea = apt.area + balconyMarketCoef * apt.bal;
  const currentRate = segmentRate(segment, assumptions);
  const currentUnadjustedValue = effectiveMarketArea * currentRate + gardenPremium(profileKey, assumptions);

  const qualityAdjustment = (research?.total_quality_adjustment_pct ?? 0) / 100;
  const currentMarketValue = currentUnadjustedValue * (1 + qualityAdjustment);
  const saleYears = yearsBetween(CALIBRATION_DATE, DEFAULT_SALE_DATE);
  const saleMarketValue = currentMarketValue * Math.pow(1 + assumptions.baseGrowthAnnual, saleYears);

  const unitMargin = CONFIDENCE_MARGIN[research?.analysis_confidence] ?? 0.03;
  const lowQuality = Math.max(-0.15, qualityAdjustment - unitMargin);
  const highQuality = qualityAdjustment + unitMargin;
  const lowMarketValue = currentUnadjustedValue
    * (1 - assumptions.marketCalibrationRange)
    * (1 + lowQuality)
    * Math.pow(1 + assumptions.downsideGrowthAnnual, saleYears);
  const highMarketValue = currentUnadjustedValue
    * (1 + assumptions.marketCalibrationRange)
    * (1 + highQuality)
    * Math.pow(1 + assumptions.upsideGrowthAnnual, saleYears);

  return {
    profileKey,
    segment,
    balconyMarketCoef,
    effectiveMarketArea,
    currentRate,
    qualityAdjustment,
    currentUnadjustedValue,
    currentMarketValue,
    saleYears,
    saleMarketValue,
    lowMarketValue,
    highMarketValue,
    unitMargin,
  };
}

export function fullModel(apt, research, assumptions) {
  const acquisition = acquisitionModel(apt, assumptions);
  const market = marketModel(apt, research, assumptions);
  const profit = market.saleMarketValue - acquisition.totalCost;
  const lowProfit = market.lowMarketValue - acquisition.totalCost;
  const highProfit = market.highMarketValue - acquisition.totalCost;
  return {
    ...acquisition,
    ...market,
    marketValue: market.saleMarketValue,
    profit,
    lowProfit,
    highProfit,
    roi: profit / acquisition.totalCost,
  };
}
