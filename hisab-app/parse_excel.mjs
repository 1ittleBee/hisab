import xlsx from 'xlsx';
import path from 'path';

const filePath = path.resolve('../Khaled - basa vara from October 2025.xlsx');
const workbook = xlsx.readFile(filePath);

console.log('Sheet Names:', workbook.SheetNames);

for (const name of workbook.SheetNames) {
  const sheet = workbook.Sheets[name];
  const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  console.log(`\n--- Sheet: ${name} (Rows: ${json.length}) ---`);
  // Print first 10 rows
  console.log(json.slice(0, 10));
}
