import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

// passwords are hashed with scrypt, which is deliberately slow so a stolen database can't be
// guessed through quickly. it comes with node, so there's nothing extra to install or compile.
// the settings are saved inside each hash, so they can be made stronger later and old
// passwords will still check out.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

function encode(salt: Buffer, key: Buffer) {
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** blocks while it works, so it's only used to create the demo users at startup. */
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

/**
 * a hash nobody knows the password to. sign-in checks against it when the username doesn't
 * exist, so a wrong username takes just as long as a wrong password and can't be told apart.
 */
export const DUMMY_HASH = hashPasswordSync(randomBytes(16).toString('hex'));
