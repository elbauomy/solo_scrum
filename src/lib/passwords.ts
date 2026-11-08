// Password hashing and rules. Uses Node's built-in scrypt (no extra packages). Pure, so it is unit-tested.
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** "scrypt$16384$8$1$<salt>$<hash>" (base64). The settings are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** A fixed hash checked when the user does not exist, so a wrong user name takes as long as a wrong password. */
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored || DUMMY_HASH).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  let key: Buffer;
  try {
    key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  return Boolean(stored) && key.length === expected.length && timingSafeEqual(key, expected);
}

export const MIN_PASSWORD_LENGTH = 10;

/** Returns a message, or null when the new password is acceptable. */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (password.toLowerCase().replace(/\s+/g, "") === username.toLowerCase().replace(/\s+/g, "")) return "The password cannot be your user name.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat one character.";
  return null;
}

/** A temporary password an administrator can hand over: 14 characters, no look-alike letters. */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 14; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
