import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Minimum password policy shared by register / reset / change-password. */
export const MIN_PASSWORD_LENGTH = 10;

/** How many previous passwords (current + history) are checked for reuse. */
export const PASSWORD_HISTORY_LIMIT = 5;

/** Only accounts with an email at one of these domains may sign up. */
export const ALLOWED_EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "mailinator.com",
];

export function isAllowedEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return !!domain && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// Upper + lower + digit + special char, no whitespace. Length checked separately
// so we can give a specific "too short" message instead of a generic regex miss.
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/;

/** Returns a user-facing error message if the password is too weak, else null. */
export function passwordStrengthError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (/\s/.test(password)) {
    return "Password cannot contain spaces.";
  }
  if (!STRONG_PASSWORD_RE.test(password)) {
    return "Password must include an uppercase letter, a lowercase letter, a number, and a special character.";
  }
  return null;
}

/**
 * Rejects passwords built from the account's own email or name — e.g.
 * "Anju@123" for anju@gmail.com. Checks the email local-part (and its
 * `.`/`_`/`-`/digit-separated pieces) plus each word of the display name,
 * case-insensitive, fragments of length >= 3 only (avoids false positives
 * on short fragments like "an").
 */
export function passwordContainsIdentityError(
  password: string,
  email: string,
  name?: string,
): string | null {
  const pwLower = password.toLowerCase();
  const fragments = new Set<string>();

  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 3) fragments.add(localPart);
  localPart.split(/[._\-\d]+/).forEach((p) => {
    if (p.length >= 3) fragments.add(p);
  });

  if (name) {
    name.toLowerCase().split(/\s+/).forEach((p) => {
      if (p.length >= 3) fragments.add(p);
    });
  }

  for (const fragment of fragments) {
    if (fragment && pwLower.includes(fragment)) {
      return "Password can't contain your name or email address.";
    }
  }
  return null;
}

/** Thrown for password-policy violations detected server-side (identity match, reuse). */
export class PasswordPolicyError extends Error {}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** True if `candidate` matches any of the given historical hashes. */
export async function isPasswordRecentlyUsed(candidate: string, hashes: string[]): Promise<boolean> {
  for (const hash of hashes) {
    if (await bcrypt.compare(candidate, hash)) return true;
  }
  return false;
}