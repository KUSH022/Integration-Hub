/**
 * Small RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, embedded newlines).
 * The first row is the header. All values are strings; use transformations for type conversion.
 */
export interface CsvResult {
  records: Record<string, string>[];
  errors: { line: number; message: string }[];
}

export function parseCsv(text: string, maxRecords = 5000): CsvResult {
  const rows: string[][] = [];
  const errors: { line: number; message: string }[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) errors.push({ line, message: 'Quote character inside an unquoted field' });
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      line++;
    } else field += ch;
  }
  if (inQuotes) errors.push({ line, message: 'Unterminated quoted field' });
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { records: [], errors: [...errors, { line: 1, message: 'CSV is empty' }] };
  const header = nonEmpty[0].map((h) => h.trim());
  if (header.some((h) => h === '')) errors.push({ line: 1, message: 'Header contains an empty column name' });
  if (new Set(header).size !== header.length) errors.push({ line: 1, message: 'Header contains duplicate column names' });
  const records: Record<string, string>[] = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    if (records.length >= maxRecords) {
      errors.push({ line: r + 1, message: `More than ${maxRecords} records; remaining rows ignored` });
      break;
    }
    const cells = nonEmpty[r];
    if (cells.length !== header.length) {
      errors.push({ line: r + 1, message: `Expected ${header.length} columns but found ${cells.length}` });
      continue;
    }
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h !== '__proto__' && h !== 'constructor' && h !== 'prototype') rec[h] = cells[idx];
    });
    records.push(rec);
  }
  return { records, errors };
}
