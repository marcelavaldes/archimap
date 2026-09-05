/**
 * Admin session token tests.
 *
 * Dependency-free and self-running so they work before this repo has a test
 * runner: `bun tests/admin-session.test.ts` (or `bun run test:auth`).
 * Exits non-zero on the first failing assertion set.
 */
import { createHmac, createHash } from 'node:crypto';
import {
  ADMIN_COOKIE, SESSION_TTL_SECONDS, getSessionSecret, timingSafeEqual,
  mintToken, verifyToken, verifyPassword, readTokenFromHeader,
} from '../src/lib/admin/session';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};

const SECRET = 'a'.repeat(64);
const OTHER  = 'b'.repeat(64);
const NOW = 1_757_000_000_000; // fixed clock

console.log('\n-- mint / verify round trip --');
const token = await mintToken(SECRET, NOW);
ok('token has exactly two dot-separated parts', token.split('.').length === 2);
ok('token is base64url only', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
const s = await verifyToken(SECRET, token, NOW);
ok('valid token verifies', s !== null);
ok('iat is now (seconds)', s?.iat === Math.floor(NOW / 1000));
ok('exp is iat + TTL', s?.exp === Math.floor(NOW / 1000) + SESSION_TTL_SECONDS);

console.log('\n-- the token is NOT the password --');
ok('token does not contain the secret', !token.includes(SECRET));
ok('token does not contain a plaintext password', !token.includes('hunter2'));

console.log('\n-- signature is a real HMAC-SHA256 (independent impl) --');
const [encoded, sig] = token.split('.');
const nodeSig = createHmac('sha256', SECRET).update(encoded).digest('base64url');
ok('matches node:crypto HMAC-SHA256 over the encoded payload', sig === nodeSig);

console.log('\n-- forgery --');
ok('wrong secret rejected', (await verifyToken(OTHER, token, NOW)) === null);
ok('flipped signature rejected',
   (await verifyToken(SECRET, `${encoded}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`, NOW)) === null);

// Re-sign a forged payload with the WRONG key: classic forgery attempt.
const forgedPayload = Buffer.from(JSON.stringify({ iat: 1, exp: 9_999_999_999 })).toString('base64url');
const forgedSig = createHmac('sha256', OTHER).update(forgedPayload).digest('base64url');
ok('payload forged with wrong key rejected',
   (await verifyToken(SECRET, `${forgedPayload}.${forgedSig}`, NOW)) === null);

// Swap in a far-future exp but keep the ORIGINAL signature: signature must not cover it.
ok('exp swapped under original signature rejected',
   (await verifyToken(SECRET, `${forgedPayload}.${sig}`, NOW)) === null);

console.log('\n-- "alg:none" / structural attacks --');
for (const bad of ['', 'garbage', encoded, `${encoded}.`, `.${sig}`, `${encoded}.${sig}.extra`,
                   `${encoded}.${sig}=`, `${encoded}.${sig}+`, `${encoded}.****`, 'a.b']) {
  ok(`rejects ${JSON.stringify(bad.length > 24 ? bad.slice(0, 24) + '…' : bad)}`,
     (await verifyToken(SECRET, bad, NOW)) === null);
}
ok('rejects null', (await verifyToken(SECRET, null, NOW)) === null);
ok('rejects undefined', (await verifyToken(SECRET, undefined, NOW)) === null);

console.log('\n-- expiry --');
const oneSecondBeforeExp = NOW + SESSION_TTL_SECONDS * 1000 - 1000;
ok('valid 1s before expiry', (await verifyToken(SECRET, token, oneSecondBeforeExp)) !== null);
ok('rejected exactly at expiry', (await verifyToken(SECRET, token, NOW + SESSION_TTL_SECONDS * 1000)) === null);
ok('rejected well after expiry', (await verifyToken(SECRET, token, NOW + SESSION_TTL_SECONDS * 2000)) === null);

// A validly-signed token whose exp is not a number must not slip through.
const nonNumericExp = Buffer.from(JSON.stringify({ iat: 1, exp: '9999999999' })).toString('base64url');
const nonNumericSig = createHmac('sha256', SECRET).update(nonNumericExp).digest('base64url');
ok('signed token with string exp rejected',
   (await verifyToken(SECRET, `${nonNumericExp}.${nonNumericSig}`, NOW)) === null);
const nullPayload = Buffer.from('null').toString('base64url');
const nullSig = createHmac('sha256', SECRET).update(nullPayload).digest('base64url');
ok('signed token with null payload rejected',
   (await verifyToken(SECRET, `${nullPayload}.${nullSig}`, NOW)) === null);

console.log('\n-- password --');
ok('correct password accepted', await verifyPassword('hunter2', 'hunter2'));
ok('wrong password rejected', !(await verifyPassword('hunter3', 'hunter2')));
ok('prefix rejected (not a length-prefix pass)', !(await verifyPassword('hunter', 'hunter2')));
ok('empty vs real rejected', !(await verifyPassword('', 'hunter2')));
ok('unicode password round-trips', await verifyPassword('mot-de-passe-éàü', 'mot-de-passe-éàü'));
ok('digest matches node sha256 (length-blind compare)',
   createHash('sha256').update('hunter2').digest('hex').length === 64);

console.log('\n-- timingSafeEqual --');
ok('equal bytes', timingSafeEqual(new Uint8Array([1,2,3]), new Uint8Array([1,2,3])));
ok('differing last byte', !timingSafeEqual(new Uint8Array([1,2,3]), new Uint8Array([1,2,4])));
ok('differing first byte', !timingSafeEqual(new Uint8Array([9,2,3]), new Uint8Array([1,2,3])));
ok('different lengths', !timingSafeEqual(new Uint8Array([1,2]), new Uint8Array([1,2,3])));
ok('empty equal', timingSafeEqual(new Uint8Array([]), new Uint8Array([])));

console.log('\n-- secret configuration (fails closed) --');
delete process.env.ADMIN_SESSION_SECRET;
ok('missing secret -> null', getSessionSecret() === null);
process.env.ADMIN_SESSION_SECRET = 'secret';
ok('short secret -> null', getSessionSecret() === null);
process.env.ADMIN_SESSION_SECRET = 'x'.repeat(31);
ok('31 chars -> null', getSessionSecret() === null);
process.env.ADMIN_SESSION_SECRET = 'x'.repeat(32);
ok('32 chars -> accepted', getSessionSecret() === 'x'.repeat(32));

console.log('\n-- bearer header parsing --');
ok('parses Bearer', readTokenFromHeader('Bearer abc') === 'abc');
ok('trims', readTokenFromHeader('Bearer  abc  ') === 'abc');
ok('rejects bare token', readTokenFromHeader('abc') === null);
ok('rejects wrong scheme', readTokenFromHeader('Basic abc') === null);
ok('rejects empty bearer', readTokenFromHeader('Bearer ') === null);
ok('rejects null header', readTokenFromHeader(null) === null);
ok('cookie name unchanged', ADMIN_COOKIE === 'admin_token');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
