// The two rules that decide whether a booking-form question applies, with no DOM and no astro
// imports, so the browser (booking.ts) and the Playwright tests share one copy.
//
// `showIfConditions` and `showIfMatches` are the same as in src/lib/form.ts and api/book.php
// (Validator.php) — the three must agree, or the browser would show a question the server rejects
// (or the reverse).

export interface ShowIfCondition {
  field: string;
  /** one value */
  equals?: string;
  /** any of several values */
  in?: string[];
}

/** A field's showIf: one condition, or a list that must all hold. */
export type ShowIf = ShowIfCondition | ShowIfCondition[];

export interface LockBy {
  field: string;
  /** dependency's answer → this field's answer */
  values: Record<string, string>;
}

/** A field's showIf as a list of conditions (one or several; all must hold). */
export const showIfConditions = (showIf: ShowIf | undefined): ShowIfCondition[] =>
  showIf === undefined ? [] : Array.isArray(showIf) ? showIf : [showIf];

/**
 * Does one showIf condition hold for its dependency's answer(s)? equals → that value is among the
 * answers; in → any of those values is; neither → there is a non-empty answer.
 */
export function showIfMatches(c: ShowIfCondition, answers: string[]): boolean {
  const vals = answers.filter(Boolean);
  if (c.equals !== undefined) return vals.includes(c.equals);
  if (c.in !== undefined) return vals.some((v) => c.in!.includes(v));
  return vals.length > 0;
}

/**
 * The answer a lockBy forces, or null when the dependency's answer is not one of its keys (or is
 * empty): then the question shows and the visitor answers it. The locked question is hidden, but its
 * answer is still submitted and validated.
 */
export function lockedValue(lock: LockBy, answers: string[] | string): string | null {
  const vals = (Array.isArray(answers) ? answers : [answers]).filter(Boolean);
  for (const v of vals) if (Object.prototype.hasOwnProperty.call(lock.values, v)) return lock.values[v];
  return null;
}
