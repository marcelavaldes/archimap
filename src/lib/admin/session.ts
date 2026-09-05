/**
 * Admin session tokens.
 *
 * The admin panel authenticates with a single shared password (this is a
 * two-person tool). The password is the *login factor* only — what it buys is
 * an opaque, expiring token signed with HMAC-SHA256 over ADMIN_SESSION_SECRET.
 * The password itself never leaves the login handler and is never stored in a
 * cookie.
 *
 * Everything here uses Web Crypto rather than node:crypto so it runs unchanged
 * in middleware (Edge runtime) and in the nodejs route handlers.
 */

/** Cookie the minted session token is stored in. */
export const ADMIN_COOKIE = 'admin_token';

/** Session lifetime. Cookie maxAge and token exp are both derived from this. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24;

/**
 * Shortest secret we accept. `openssl rand -hex 32` yields 64 characters, so
 * this leaves plenty of margin while still refusing a placeholder like "secret".
 * A weak signing key makes every token forgeable, so this fails closed.
 */
const MIN_SECRET_LENGTH = 32;

export interface AdminSession {
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/**
 * The HMAC signing key, or null when it is missing or too weak to trust.
 *
 * Referenced statically so the Next.js bundler can inline it into the Edge
 * middleware bundle — `process.env[name]` would not be inlined.
 */
export function getSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

/**
 * Constant-time byte comparison.
 *
 * Callers compare fixed-length digests (SHA-256 or HMAC-SHA256 output), so a
 * length mismatch means a malformed input rather than a near-miss guess and
 * returning early on it leaks nothing useful.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(signature);
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return new Uint8Array(digest);
}

/**
 * Compare a submitted password against the configured one in constant time.
 *
 * Both sides are hashed first so the comparison is over two 32-byte digests:
 * that keeps it length-blind, which a direct byte compare of the raw strings
 * would not be.
 */
export async function verifyPassword(
  candidate: string,
  expected: string
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return timingSafeEqual(a, b);
}

/**
 * Mint a signed session token: `base64url(payload).base64url(signature)`.
 *
 * The signature covers the *encoded* payload, so verification never has to
 * re-serialise JSON and cannot be tricked by a different-but-equivalent
 * encoding of the same object.
 */
export async function mintToken(secret: string, now: number = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: AdminSession = { iat, exp: iat + SESSION_TTL_SECONDS };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(secret, encoded);
  return `${encoded}.${toBase64Url(signature)}`;
}

/**
 * Verify a token and return its session, or null if it is malformed, forged or
 * expired. Never throws — every failure path is a null.
 */
export async function verifyToken(
  secret: string,
  token: string | null | undefined,
  now: number = Date.now()
): Promise<AdminSession | null> {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSignature] = parts;

  const provided = fromBase64Url(providedSignature);
  if (!provided) return null;

  // Authenticate before parsing: nothing downstream sees attacker-chosen JSON
  // unless the signature already checked out.
  const expected = await hmac(secret, encoded);
  if (!timingSafeEqual(provided, expected)) return null;

  const payloadBytes = fromBase64Url(encoded);
  if (!payloadBytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { iat, exp } = parsed as Partial<AdminSession>;
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;

  if (Math.floor(now / 1000) >= (exp as number)) return null;

  return { iat: iat as number, exp: exp as number };
}

/**
 * Pull a session token off a request: `Authorization: Bearer <token>` first,
 * then the cookie. The Bearer path exists for scripted callers; the browser
 * admin UI uses the cookie.
 */
export function readTokenFromHeader(authorization: string | null): string | null {
  if (!authorization) return null;
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
