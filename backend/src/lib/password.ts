import bcrypt from "bcryptjs";
const SALT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 10;
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
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/; 
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
export class PasswordPolicyError extends Error {}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
export async function isPasswordRecentlyUsed(candidate: string, hashes: string[]): Promise<boolean> {
  for (const hash of hashes) {
    if (await bcrypt.compare(candidate, hash)) return true;
  }
  return false;
}