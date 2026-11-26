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

/**
 * A temporary password an administrator can hand over: at least 14 characters (more when the minimum is higher),
 * always with letters and numbers, no look-alike characters.
 */
export function generateTemporaryPassword(minLength = 8): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const length = Math.max(14, minLength);
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += all[randomInt(all.length)];
    if (/[a-zA-Z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}
