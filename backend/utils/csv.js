// CSV parser — รองรับ BOM, quoted fields, ค่าภาษาไทย
// คืน array ของ object โดย key มาจาก header row (case ตามไฟล์ — ผู้เรียกใช้ getValueStrict เอง)

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const parseLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

// buffer หรือ string → [{col: value, ...}]
const parseCsv = (input) => {
  const text = stripBom(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').trim();
    });
    return row;
  });
};

// header row ของไฟล์ (เทียบ DictReader.fieldnames — ใช้เช็คคอลัมน์ก่อน parse ทั้งไฟล์)
const csvHeaders = (input) => {
  const text = stripBom(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '');
  return firstLine ? parseLine(firstLine).map((h) => h.trim()) : [];
};

// อ่านค่าจาก row แบบ case-insensitive (port ของ get_value_strict)
const getValueStrict = (row, key) => {
  if (key in row) return row[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
};

module.exports = { parseCsv, csvHeaders, getValueStrict };
