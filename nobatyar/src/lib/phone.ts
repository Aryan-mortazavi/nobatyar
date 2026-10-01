/**
 * Mobile number normalisation.
 *
 * Customers type their number in whatever their keyboard produced: Persian
 * digits, spaces, dashes, a +98 prefix, or 0098. All of those mean the same
 * person, so the channel and the web app must agree on one canonical form or a
 * customer ends up with two accounts.
 *
 * Canonical form: `09xxxxxxxxx` (Iranian mobile, national notation).
 * Pure and dependency-free so it can be unit tested.
 */

/** ۰۱۲۳۴۵۶۷۸۹ → 0123456789 (also handles the Arabic-Indic ٠١٢٣٤٥٦٧٨٩). */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (char) => {
    const persian = "۰۱۲۳۴۵۶۷۸۹".indexOf(char);
    if (persian >= 0) return String(persian);
    return String("٠١٢٣٤٥٦٧٨٩".indexOf(char));
  });
}

export type PhoneNormalisation =
  | { ok: true; phone: string; e164: string }
  | { ok: false; reason: "too_short" | "not_mobile" };

export function normalisePhone(input: string): PhoneNormalisation {
  let digits = toLatinDigits(input ?? "").replace(/[\s()\-_.]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0098")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9") && digits.length === 10) digits = `0${digits}`;

  if (digits.length < 10) return { ok: false, reason: "too_short" };
  // Iranian mobiles are 09 followed by nine digits. The third digit is the
  // operator prefix (091x, 093x, 094x, 099x…) and is *not* always 9.
  if (!/^09\d{9}$/.test(digits)) {
    return { ok: false, reason: "not_mobile" };
  }
  return { ok: true, phone: digits, e164: `+98${digits.slice(1)}` };
}

/** Convenience for the common "give me the canonical form or null" case. */
export function phoneOrNull(input: string): string | null {
  const result = normalisePhone(input);
  return result.ok ? result.phone : null;
}

/** Loose check for sign-up forms: does this look like a usable mobile number? */
export function isValidPhone(input: string): boolean {
  return normalisePhone(input).ok;
}
