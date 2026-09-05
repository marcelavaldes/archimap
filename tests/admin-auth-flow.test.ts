/**
 * Admin auth flow tests — middleware gate, login handler and verifyAdmin,
 * exercised over real NextRequest objects rather than mocks.
 *
 * Dependency-free and self-running so they work before this repo has a test
 * runner: `bun tests/admin-auth-flow.test.ts` (or `bun run test:auth`).
 */
import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';
import { POST as login } from '@/app/api/admin/login/route';
import { verifyAdmin } from '@/lib/admin/auth';
import { mintToken, SESSION_TTL_SECONDS } from '@/lib/admin/session';

const PASSWORD = 'test-admin-password';
const SECRET = 'f'.repeat(64);
process.env.ADMIN_PASSWORD = PASSWORD;
process.env.ADMIN_SESSION_SECRET = SECRET;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const isNext = (r: Response) => r.headers.get('x-middleware-next') === '1';
const rewriteTo = (r: Response) => r.headers.get('x-middleware-rewrite');
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never);
const withCookie = (url: string, v: string) => req(url, { headers: { cookie: `admin_token=${v}` } });
const withBearer = (url: string, v: string) => req(url, { headers: { authorization: `Bearer ${v}` } });

console.log('\n-- matcher config --');
ok('matches /admin/:path*', config.matcher.includes('/admin/:path*'));
ok('matches /api/admin/:path*', config.matcher.includes('/api/admin/:path*'));

console.log('\n-- middleware: unauthenticated API --');
for (const p of ['/api/admin/dashboard', '/api/admin/criteria', '/api/admin/data/x/upload',
                 '/api/admin/ingestion/x/run', '/api/admin/criteria/1/toggle']) {
  ok(`401 on ${p}`, (await middleware(req(p))).status === 401);
}
ok('/api/admin/login passes through', isNext(await middleware(req('/api/admin/login', { method: 'POST' }))));

console.log('\n-- middleware: page gate --');
const deep = await middleware(req('/admin/criteria'));
ok('/admin/criteria rewritten to the login form', rewriteTo(deep)?.endsWith('/admin') === true);
ok('/admin/criteria not a redirect (URL preserved)', deep.status !== 307 && deep.status !== 302);
const root = await middleware(req('/admin'));
ok('/admin itself passes (no rewrite loop)', isNext(root) && !rewriteTo(root));

console.log('\n-- login handler --');
const bad = await login(req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) }));
ok('wrong password -> 401', bad.status === 401);
ok('wrong password sets no cookie', !bad.cookies.get('admin_token'));
ok('malformed body -> 400',
   (await login(req('/api/admin/login', { method: 'POST', body: 'not json' }))).status === 400);
ok('non-string password -> 401 (no type confusion)',
   (await login(req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: { $ne: null } }) }))).status === 401);

const good = await login(req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) }));
ok('correct password -> 200', good.status === 200);
const setCookie = good.cookies.get('admin_token');
ok('sets admin_token cookie', !!setCookie);
ok('cookie is httpOnly', setCookie?.httpOnly === true);
ok('cookie sameSite=lax', setCookie?.sameSite === 'lax');
ok('cookie path=/', setCookie?.path === '/');
ok('cookie maxAge = session TTL', setCookie?.maxAge === SESSION_TTL_SECONDS);

const issued = setCookie!.value;
console.log('\n-- the cookie is a token, not the password --');
ok('cookie value !== ADMIN_PASSWORD', issued !== PASSWORD);
ok('cookie does not contain the password', !issued.includes(PASSWORD));
ok('cookie does not contain the signing secret', !issued.includes(SECRET));
ok('cookie is a signed two-part token', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(issued));

console.log('\n-- the issued cookie grants access --');
ok('middleware admits issued cookie (api)', isNext(await middleware(withCookie('/api/admin/dashboard', issued))));
ok('middleware admits issued cookie (page)', isNext(await middleware(withCookie('/admin/criteria', issued))));
ok('verifyAdmin admits issued cookie', (await verifyAdmin(withCookie('/api/admin/dashboard', issued))) === null);

console.log('\n-- regression: the password is no longer a credential --');
ok('password-as-cookie rejected by middleware', (await middleware(withCookie('/api/admin/dashboard', PASSWORD))).status === 401);
ok('password-as-cookie rejected by verifyAdmin', (await verifyAdmin(withCookie('/api/admin/dashboard', PASSWORD)))?.status === 401);
ok('password-as-bearer rejected by middleware', (await middleware(withBearer('/api/admin/dashboard', PASSWORD))).status === 401);
ok('password-as-bearer rejected by verifyAdmin', (await verifyAdmin(withBearer('/api/admin/dashboard', PASSWORD)))?.status === 401);

console.log('\n-- the Bearer path still works, with a real token --');
ok('middleware admits Bearer token', isNext(await middleware(withBearer('/api/admin/dashboard', issued))));
ok('verifyAdmin admits Bearer token', (await verifyAdmin(withBearer('/api/admin/dashboard', issued))) === null);

console.log('\n-- tampering and expiry over the request path --');
const tampered = issued.slice(0, -1) + (issued.at(-1) === 'A' ? 'B' : 'A');
ok('tampered cookie -> 401 (middleware)', (await middleware(withCookie('/api/admin/dashboard', tampered))).status === 401);
ok('tampered cookie -> 401 (verifyAdmin)', (await verifyAdmin(withCookie('/api/admin/dashboard', tampered)))?.status === 401);
const expired = await mintToken(SECRET, Date.now() - (SESSION_TTL_SECONDS + 60) * 1000);
ok('expired cookie -> 401 (middleware)', (await middleware(withCookie('/api/admin/dashboard', expired))).status === 401);
ok('expired cookie -> 401 (verifyAdmin)', (await verifyAdmin(withCookie('/api/admin/dashboard', expired)))?.status === 401);
ok('token signed with another secret -> 401',
   (await middleware(withCookie('/api/admin/dashboard', await mintToken('9'.repeat(64), Date.now())))).status === 401);

console.log('\n-- fails closed when misconfigured --');
delete process.env.ADMIN_SESSION_SECRET;
ok('no secret: api -> 500', (await middleware(req('/api/admin/dashboard'))).status === 500);
ok('no secret: page -> 500', (await middleware(req('/admin/criteria'))).status === 500);
ok('no secret: verifyAdmin -> 500', (await verifyAdmin(withCookie('/api/admin/dashboard', issued)))?.status === 500);
ok('no secret: login -> 500',
   (await login(req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) }))).status === 500);
process.env.ADMIN_SESSION_SECRET = SECRET;
delete process.env.ADMIN_PASSWORD;
ok('no password: login -> 500',
   (await login(req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) }))).status === 500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
