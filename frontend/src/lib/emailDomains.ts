// Mirrors ALLOWED_EMAIL_DOMAINS / isAllowedEmailDomain in the backend's
// lib/password.ts exactly. This is just so the UI can show an inline error
// before submitting — the backend (routes/invites.ts) is the authoritative
// enforcement.
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