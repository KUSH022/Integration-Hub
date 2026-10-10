/** Small, dependency-free date parsing/formatting. All calculations are UTC. */
export const INPUT_DATE_FORMATS = ['AUTO', 'ISO', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'EPOCH_MS'] as const;
export const OUTPUT_DATE_FORMATS = ['YYYY-MM-DD', 'ISO_DATETIME', 'MM/DD/YYYY', 'DD/MM/YYYY', 'EPOCH_MS'] as const;
export const VALIDATION_DATE_FORMATS = ['YYYY-MM-DD', 'ISO_DATETIME', 'MM/DD/YYYY', 'DD/MM/YYYY'] as const;
export type InputDateFormat = (typeof INPUT_DATE_FORMATS)[number];
export type OutputDateFormat = (typeof OUTPUT_DATE_FORMATS)[number];
export type ValidationDateFormat = (typeof VALIDATION_DATE_FORMATS)[number];

function ymd(y: number, m: number, d: number): Date | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. Feb 30
  return dt;
}

const RE_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_SLASH = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const RE_ISO_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseDate(value: unknown, format: InputDateFormat): Date | null {
  if (format === 'EPOCH_MS' || (format === 'AUTO' && typeof value === 'number')) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(n)) return null;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const tryYmd = () => {
    const m = RE_YMD.exec(s);
    return m ? ymd(+m[1], +m[2], +m[3]) : null;
  };
  const tryIso = () => {
    const m = RE_ISO_DT.exec(s);
    if (!m) return null;
    if (!ymd(+m[1], +m[2], +m[3])) return null;
    if (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59)) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const tryMdy = () => {
    const m = RE_SLASH.exec(s);
    return m ? ymd(+m[3], +m[1], +m[2]) : null;
  };
  const tryDmy = () => {
    const m = RE_SLASH.exec(s);
    return m ? ymd(+m[3], +m[2], +m[1]) : null;
  };
  switch (format) {
    case 'YYYY-MM-DD':
      return tryYmd();
    case 'ISO':
      return tryIso() ?? tryYmd();
    case 'MM/DD/YYYY':
      return tryMdy();
    case 'DD/MM/YYYY':
      return tryDmy();
    case 'AUTO':
      // Slash formats are ambiguous, so AUTO only accepts unambiguous ISO forms.
      return tryIso() ?? tryYmd();
    default:
      return null;
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(d: Date, format: OutputDateFormat): string | number {
  const y = pad(d.getUTCFullYear(), 4);
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  switch (format) {
    case 'YYYY-MM-DD':
      return `${y}-${m}-${day}`;
    case 'MM/DD/YYYY':
      return `${m}/${day}/${y}`;
    case 'DD/MM/YYYY':
      return `${day}/${m}/${y}`;
    case 'ISO_DATETIME':
      return d.toISOString();
    case 'EPOCH_MS':
      return d.getTime();
  }
}

export function isValidDateString(value: unknown, format: ValidationDateFormat): boolean {
  if (typeof value !== 'string') return false;
  switch (format) {
    case 'YYYY-MM-DD':
      return parseDate(value, 'YYYY-MM-DD') !== null;
    case 'ISO_DATETIME':
      return RE_ISO_DT.test(value.trim()) && parseDate(value, 'ISO') !== null;
    case 'MM/DD/YYYY':
      return parseDate(value, 'MM/DD/YYYY') !== null;
    case 'DD/MM/YYYY':
      return parseDate(value, 'DD/MM/YYYY') !== null;
  }
}
