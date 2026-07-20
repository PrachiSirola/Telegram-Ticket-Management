import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Minimum password policy shared by register / reset / change-password. */
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
