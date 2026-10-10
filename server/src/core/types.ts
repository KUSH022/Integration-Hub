/** A field-level problem detected during transformation or validation. */
export interface FieldError {
  /** Destination (target) field path, or source path when the error relates to the source. */
  field: string;
  /** Source field the value came from, when applicable. */
  sourceField?: string;
  /** Rule or transform that produced the error (e.g. "required", "formatDate"). */
  rule: string;
  /** Human-readable reason. */
  message: string;
  /** Short preview of the offending value (never secrets: source payloads are business data). */
  value?: string;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function previewValue(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
