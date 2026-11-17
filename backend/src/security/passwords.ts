import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const DERIVED_KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, DERIVED_KEY_LENGTH)) as Buffer;
  // Salt is public, but the original password must never be stored.
  return "scrypt:" + salt + ":" + derived.toString("hex");
}

export async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const [algorithm, salt, expectedHex, extra] = encoded.split(":");
  if (algorithm !== "scrypt" || extra !== undefined ||
      !/^[0-9a-f]{32}$/i.test(salt ?? "") ||
      !/^[0-9a-f]{128}$/i.test(expectedHex ?? "")) {
    return false;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, DERIVED_KEY_LENGTH)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validDemoPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

export function normalizeDemoEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Fictional domains only. Email ownership is NOT verified in this prototype.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!email.endsWith("@example.test") && !email.endsWith("@example.com")) {
    return null;
  }
  return email;
}

export function validName(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 100;
}
