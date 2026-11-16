import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

// scrypt is slow on purpose so stolen hashes are hard to crack; built into node
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function encode(salt: Buffer, key: Buffer) {
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

// sync version only for seeding demo users at startup
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16);
  return encode(salt, scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P }));
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return Promise.resolve(false);
  const expected = Buffer.from(key, 'base64');
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt, 'base64'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, actual) => (err ? reject(err) : resolve(timingSafeEqual(actual, expected))),
    );
  });
}

// used when the username is wrong, so timing looks the same as a wrong password
export const DUMMY_HASH = hashPasswordSync(randomBytes(16).toString('hex'));
