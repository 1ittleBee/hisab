import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

const filePath = path.resolve('../Khaled - basa vara from October 2025.xlsx');
const workbook = xlsx.readFile(filePath);

export const DEFAULT_MEMBERS = [
  { id: 'sowpnil', name: 'Sowpnil', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'miraj', name: 'Miraj', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'ashik', name: 'Ashik', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'khaled', name: 'Khaled', roomType: 'single', roomLabel: 'Single / Master Room', baseRent: 4050 },
  { id: 'kanchon', name: 'Kanchon', roomType: 'medium', roomLabel: 'Medium Room', baseRent: 3700 },
  { id: 'rafi', name: 'Rafi', roomType: 'shared', roomLabel: 'Shared Room', baseRent: 3300 },
  { id: 'turag', name: 'Turag', roomType: 'shared', roomLabel: 'Shared Room', baseRent: 3300 }
];

function normalizeName(name) {
  if (!name) return '';
  const s = String(name).trim().toLowerCase();
  if (s.includes('sowpnil')) return 'sowpnil';
  if (s.includes('miraj')) return 'miraj';
  if (s.includes('ashik')) return 'ashik';
  if (s.includes('khaled')) return 'khaled';
  if (s.includes('kanchon') || s.includes('nishat')) return 'kanchon';
  if (s.includes('rafi')) return 'rafi';
  if (s.includes('turag') || s.includes('rafee') || s.includes('asraf') || s.includes('baray')) return 'turag';
  return s;
}

const monthsList = [];

for (const name of workbook.SheetNames) {
  if (name.includes('New Calculation')) continue;
  const sheet = workbook.Sheets[name];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length === 0) continue;

  const header = rows[0] || [];
  // Find column indices
  let haveToPayIdx = 1;
  let paidIdx = 2;
  let remainingIdx = 4;
  let thisMonthIdx = -1;

  for (let c = 0; c < header.length; c++) {
    const colName = String(header[c] || '').toLowerCase().trim();
    if (colName.includes('this month')) thisMonthIdx = c;
    if (colName.includes('have to pay')) haveToPayIdx = c;
    if (colName.includes('paid')) paidIdx = c;
    if (colName.includes('remaining')) remainingIdx = c;
  }

  const records = {};
  for (let r = 1; r < Math.min(rows.length, 12); r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const memberId = normalizeName(row[0]);
    if (!memberId) continue;

    const thisMonthVal = thisMonthIdx !== -1 && typeof row[thisMonthIdx] === 'number' ? row[thisMonthIdx] : null;
    const haveToPayVal = typeof row[haveToPayIdx] === 'number' ? row[haveToPayIdx] : 0;
    const paidVal = typeof row[paidIdx] === 'number' ? row[paidIdx] : 0;
    const remainingVal = typeof row[remainingIdx] === 'number' ? row[remainingIdx] : (paidVal - haveToPayVal);

    records[memberId] = {
      memberId,
      name: row[0].trim(),
      thisMonth: thisMonthVal !== null ? thisMonthVal : haveToPayVal,
      haveToPay: haveToPayVal,
      paid: paidVal,
      remaining: remainingVal
    };
  }

  monthsList.push({
    id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: name,
    records
  });
}

const seedData = {
  members: DEFAULT_MEMBERS,
  currentMonthId: 'november-2026',
  history: monthsList
};

fs.writeFileSync('./src/seedData.json', JSON.stringify(seedData, null, 2));
console.log('Successfully wrote src/seedData.json with', monthsList.length, 'months');
