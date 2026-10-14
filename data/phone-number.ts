/**
 * -------------------------------------------------------------------------
 * @file   phone-number.ts
 * @brief  Normalizes supported phone numbers to E.164.
 *
 * @description
 *  Accepts formatted North American numbers and returns canonical +1 values.
 *
 * @remarks
 *  The first-release inventory intentionally accepts only +1 numbers.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export function normalizeE164PhoneNumber(input: string): string | null {
  if (!input || !/^\+?[0-9\s().-]+$/.test(input)) {
    return null;
  }
  const digits = input.replace(/\D/g, "");
  if (input.startsWith("+") && !digits.startsWith("1")) {
    return null;
  }
  const national = digits.length === 10 ? digits : digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : null;
  if (!national || national[0] === "0" || national[0] === "1" || national[3] === "0" || national[3] === "1") {
    return null;
  }
  return `+1${national}`;
}
