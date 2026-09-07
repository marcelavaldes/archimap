/**
 * The fixture-mode admin credentials must not be able to weaken a real deploy.
 *
 * Fixture mode substitutes a published password and a published signing key so
 * a clone with no .env can open the admin panel. That is a hole shaped exactly
 * like the one the signed-session work in commit 7b4542c closed, so it gets its
 * own test rather than an argument: with ARCHIMAP_FIXTURE unset the behaviour
 * must be byte-for-byte what it was, and even with it set a production
 * NODE_ENV must refuse the substitutes.
 *
 * The flag is read per call (isFixtureMode(), not a module-level const) purely
 * so these assertions can exist — a const frozen at import time would make
 * "same process, flag off" untestable.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  FIXTURE_ADMIN_PASSWORD,
  getAdminPassword,
  getSessionSecret,
} from '@/lib/admin/session';
import { isFixtureAdminAllowed, isFixtureMode } from '@/lib/fixture';

const REAL_SECRET = 'c'.repeat(64);
const REAL_PASSWORD = 'a-real-admin-password';

/** Restore whatever the surrounding suite had configured. */
const saved = {
  fixture: process.env.ARCHIMAP_FIXTURE,
  nodeEnv: process.env.NODE_ENV,
  password: process.env.ADMIN_PASSWORD,
  secret: process.env.ADMIN_SESSION_SECRET,
};

/**
 * `process.env` is typed with NODE_ENV read-only, which is right for app code
 * and wrong here: the whole point of this file is to prove behaviour changes
 * with it. Written through a widened alias rather than a per-line ts-expect.
 */
const mutableEnv = process.env as unknown as Record<string, string | undefined>;

function env(vars: {
  fixture?: string;
  nodeEnv?: string;
  password?: string;
  secret?: string;
}) {
  for (const [key, name] of [
    ['fixture', 'ARCHIMAP_FIXTURE'],
    ['nodeEnv', 'NODE_ENV'],
    ['password', 'ADMIN_PASSWORD'],
    ['secret', 'ADMIN_SESSION_SECRET'],
  ] as const) {
    const value = vars[key];
    if (value === undefined) delete mutableEnv[name];
    else mutableEnv[name] = value;
  }
}

afterEach(() => {
  env({
    fixture: saved.fixture,
    nodeEnv: saved.nodeEnv,
    password: saved.password,
    secret: saved.secret,
  });
});

describe('with ARCHIMAP_FIXTURE unset, nothing changes', () => {
  test('missing credentials still fail closed', () => {
    env({ nodeEnv: 'development' });
    expect(isFixtureMode()).toBe(false);
    expect(isFixtureAdminAllowed()).toBe(false);
    expect(getSessionSecret()).toBeNull();
    expect(getAdminPassword()).toBeNull();
  });

  test('a too-short secret is still refused', () => {
    env({ nodeEnv: 'development', secret: 'short' });
    expect(getSessionSecret()).toBeNull();
  });

  test('configured credentials are returned unchanged', () => {
    env({ nodeEnv: 'development', secret: REAL_SECRET, password: REAL_PASSWORD });
    expect(getSessionSecret()).toBe(REAL_SECRET);
    expect(getAdminPassword()).toBe(REAL_PASSWORD);
  });
});

describe('with ARCHIMAP_FIXTURE=1 in development', () => {
  test('the substitutes are offered when nothing is configured', () => {
    env({ fixture: '1', nodeEnv: 'development' });
    expect(isFixtureAdminAllowed()).toBe(true);
    expect(getAdminPassword()).toBe(FIXTURE_ADMIN_PASSWORD);
    const secret = getSessionSecret();
    expect(secret).not.toBeNull();
    expect(secret!.length).toBeGreaterThanOrEqual(32);
  });

  test('a configured secret always wins over the substitute', () => {
    env({ fixture: '1', nodeEnv: 'development', secret: REAL_SECRET, password: REAL_PASSWORD });
    expect(getSessionSecret()).toBe(REAL_SECRET);
    expect(getAdminPassword()).toBe(REAL_PASSWORD);
  });

  test('the substitute password is not the substitute signing key', () => {
    env({ fixture: '1', nodeEnv: 'development' });
    expect(getSessionSecret()).not.toBe(getAdminPassword());
  });
});

describe('NODE_ENV=production is a second, independent lock', () => {
  test('the flag alone does not unlock the substitutes', () => {
    env({ fixture: '1', nodeEnv: 'production' });
    expect(isFixtureMode()).toBe(true);
    expect(isFixtureAdminAllowed()).toBe(false);
    expect(getSessionSecret()).toBeNull();
    expect(getAdminPassword()).toBeNull();
  });

  test('a production deploy with real credentials is unaffected by the flag', () => {
    env({ fixture: '1', nodeEnv: 'production', secret: REAL_SECRET, password: REAL_PASSWORD });
    expect(getSessionSecret()).toBe(REAL_SECRET);
    expect(getAdminPassword()).toBe(REAL_PASSWORD);
  });
});

describe('the flag is exact, not truthy', () => {
  for (const value of ['0', 'true', 'yes', '', 'TRUE']) {
    test(`ARCHIMAP_FIXTURE=${JSON.stringify(value)} does not enable fixture mode`, () => {
      env({ fixture: value, nodeEnv: 'development' });
      expect(isFixtureMode()).toBe(false);
      expect(getAdminPassword()).toBeNull();
    });
  }
});
