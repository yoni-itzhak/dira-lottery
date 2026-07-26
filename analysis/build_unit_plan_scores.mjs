import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APARTMENTS } from '../app/src/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const profiles = JSON.parse(
  fs.readFileSync(path.join(here, 'apartment_type_analysis.json'), 'utf8'),
);

function profileKey(apt) {
  if (apt.b === 3 && apt.apt === 1) return '3G-1';
  if (apt.b === 3 && apt.apt === 2) return '3G-2';
  return apt.type;
}

function unitNote(apt) {
  const notes = [];
  if (apt.floor === 0) {
    notes.push('קומת קרקע: לבדוק פרטיות, ביטחון, לחות ורעש שבילים');
  } else if (apt.floor === 1) {
    notes.push('קומה 1: לבדוק פרטיות ורעש מהקרקע');
  } else if (apt.floor >= 6) {
    notes.push('קומה גבוהה יחסית: פוטנציאל לפתיחות ופרטיות, בכפוף לחסימות');
  } else {
    notes.push(`קומה ${apt.floor}: אין להחיל פרמיה אוטומטית ללא בדיקת חסימות`);
  }

  if (apt.park === 'full') {
    notes.push('מסומנת כפונה לפארק; נדרש אימות קו ראייה בכל קומה');
  } else if (apt.park === 'partial') {
    notes.push('חשיפה חלקית לפארק/חסימה; נדרש ניתוח קו ראייה');
  } else {
    notes.push('ללא סימון נוף לפארק בנתוני האפליקציה');
  }

  notes.push(`כיוון רשום: ${apt.dir}`);
  return notes.join('; ');
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = APARTMENTS.filter((apt) => apt.prog).map((apt) => {
  const key = profileKey(apt);
  const profile = profiles[key];
  if (!profile) throw new Error(`Missing plan profile for ${apt.b}-${apt.apt} (${key})`);

  return {
    building: apt.b,
    apartment: apt.apt,
    floor: apt.floor,
    type: apt.type,
    profile_key: key,
    rooms: apt.rooms,
    internal_area_m2: apt.area,
    balcony_area_m2: apt.bal,
    direction: apt.dir,
    park: apt.park,
    plan_score: profile.score,
    plan_tier: profile.tier,
    design_adjustment_pct_preliminary: profile.design_adj_pct,
    plan_summary: profile.summary,
    outdoor_analysis: profile.outdoor,
    unit_specific_note: unitNote(apt),
  };
});

const columns = Object.keys(rows[0]);
const csv = [
  columns.join(','),
  ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
].join('\n');

const output = path.join(here, 'apartment_plan_scores_by_unit.csv');
fs.writeFileSync(output, `\uFEFF${csv}\n`, 'utf8');
console.log(`Created ${output} with ${rows.length} apartments.`);
