// Field validation for the booking form. Messages say how to fix the problem, not just that there is one.
// Pure functions (no DOM). The server (api/book.php) re-validates against /api/form-schema.json.
import type { ResolvedField } from '../../lib/form';

export type Value = string | string[];

export interface ValidateContext {
  /** Today in Toronto, YYYY-MM-DD. */
  today: string;
  /** Event dates (preferred / backup) can't be in the past. */
  notBeforeToday?: boolean;
  /** Word limit (letter board). */
  maxWords?: number;
}

export const PHONE_MESSAGE = 'Enter a phone number with area code, e.g. 647 555 0123';
export const EMAIL_MESSAGE = 'Enter an email address like name@example.com';
export const PAST_DATE_MESSAGE = 'Enter a date that’s today or later';

// Friendlier wording for the core questions every booking has. Everything else gets a message built
// from its label, so new questions in booking-form.yaml need no code.
const REQUIRED_MESSAGES: Record<string, string> = {
  occasion: 'Choose what we’re celebrating',
  package: 'Choose a package, or “Help me choose”',
  date: 'Enter your preferred date',
  start_time: 'Enter a preferred start time, e.g. 4:00 PM',
  guests_adults: 'Enter the number of adults (at least 1)',
  location_type: 'Choose where you’d like your picnic',
  location: 'Enter an address, park name or area',
  name: 'Enter your name',
  phone: PHONE_MESSAGE,
  email: EMAIL_MESSAGE,
};

const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function requiredMessage(f: Pick<ResolvedField, 'id' | 'label' | 'type'>): string {
  if (REQUIRED_MESSAGES[f.id]) return REQUIRED_MESSAGES[f.id];
  const label = f.label.trim();
  if (['radio', 'select', 'checkboxes'].includes(f.type)) return `Choose an answer for “${label.replace(/[?:]$/, '')}”`;
  if (/\?$/.test(label)) return `Answer “${label}”`;
  const phrase = lcFirst(label);
  const article = /^(your|both|their|his|her|a|an|the)\b/i.test(label) ? '' : 'the ';
  return `Enter ${article}${phrase}`;
}

export const wordCount = (s: string) => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidPhone(v: string): boolean {
  const raw = v.trim();
  // Allow common punctuation and an extension; reject anything with other letters.
  if (/[a-wyz]/i.test(raw.replace(/\b(ext|x)\.?\s*\d+$/i, ''))) return false;
  const digits = raw.replace(/\b(ext|x)\.?\s*\d+$/i, '').replace(/\D/g, '');
  if (raw.startsWith('+') && !raw.startsWith('+1')) return digits.length >= 8 && digits.length <= 15;
  const n = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return n.length === 10 && /^[2-9]\d{2}[2-9]/.test(n);
}

export function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's date in Toronto as YYYY-MM-DD (the business's time zone, whatever the visitor's). */
export function torontoToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Returns an error message, or null when the value is fine. */
export function validateField(f: ResolvedField, value: Value, ctx: ValidateContext): string | null {
  const empty = Array.isArray(value) ? value.length === 0 : value.trim() === '';
  if (empty) return f.required ? requiredMessage(f) : null;
  if (Array.isArray(value)) return null;

  const v = value.trim();
  switch (f.type) {
    case 'email':
      if (!EMAIL.test(v)) return EMAIL_MESSAGE;
      break;
    case 'tel':
      if (!isValidPhone(v)) return PHONE_MESSAGE;
      break;
    case 'number': {
      if (!/^\d+$/.test(v)) return 'Enter a whole number, like 4';
      const n = Number(v);
      const { min, max } = f;
      if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
        if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}`;
        if (min !== undefined) return `Enter ${min} or more`;
        return `Enter ${max} or fewer`;
      }
      break;
    }
    case 'date':
      if (!isRealDate(v)) return 'Enter a real date, e.g. 24/10/2026';
      if (ctx.notBeforeToday && v < ctx.today) return PAST_DATE_MESSAGE;
      break;
    case 'time':
      if (!/^\d{2}:\d{2}/.test(v)) return 'Enter a time, e.g. 4:30 PM';
      break;
    case 'radio':
    case 'select':
      if (f.options && !f.options.some((o) => o.value === v)) return requiredMessage(f);
      break;
  }
  if (f.maxLength && v.length > f.maxLength) return `Keep this to ${f.maxLength} characters or fewer`;
  if (ctx.maxWords) {
    const n = wordCount(v);
    if (n > ctx.maxWords) return `Keep it to ${ctx.maxWords} words or fewer — it’s ${n} now`;
  }
  return null;
}
