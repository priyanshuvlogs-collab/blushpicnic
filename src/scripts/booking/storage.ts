// sessionStorage helpers. Storage can be unavailable (private mode, blocked cookies) — never let that
// break the form: every access is wrapped and failures fall back to "nothing saved".

export const STATE_KEY = 'bp-booking-v1';
export const DONE_KEY = 'bp-booking-done';

export type Answers = Record<string, string | string[]>;

export interface BookingState {
  v: 1;
  /** Current step: 1–4, or 5 for Review & send. */
  step: number;
  /** Furthest step reached (lets the progress bar and "Review" jump forward again). */
  maxStep: number;
  values: Answers;
  /** Epoch ms when the visitor first opened the form (sent as _ts). */
  startedAt: number;
  /** The deep-link query already applied, so a reload doesn't override later changes. */
  query: string;
  /** booking_start already sent. */
  started: boolean;
}

export interface DoneInfo {
  firstName: string;
  occasion: string;
  occasionName?: string;
  ref?: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — the form still works, it just won't survive a reload */
  }
}

export function loadState(): BookingState | null {
  const s = read<BookingState>(STATE_KEY);
  if (!s || s.v !== 1 || typeof s.values !== 'object' || s.values === null) return null;
  return s;
}

export const saveState = (s: BookingState) => write(STATE_KEY, s);

export function clearState(): void {
  try {
    window.sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
}

export const saveDone = (d: DoneInfo) => write(DONE_KEY, d);
export const loadDone = () => read<DoneInfo>(DONE_KEY);
