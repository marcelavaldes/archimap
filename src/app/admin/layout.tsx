'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AdminContextType {
  authenticated: boolean;
  /** True when the panel is reading fixture files instead of a database. */
  fixture: boolean;
}

const AdminContext = createContext<AdminContextType>({ authenticated: false, fixture: false });

export function useAdminContext() {
  return useContext(AdminContext);
}

interface SessionResponse {
  authenticated: boolean;
  fixture: boolean;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [fixture, setFixture] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();

  const checkAuth = useCallback(async () => {
    try {
      // /api/admin/session, not /api/admin/dashboard. The old probe ran four
      // COUNT(*) queries and a scan of the coverage view purely to read
      // `res.ok`, on every navigation into the panel — and twice on the
      // dashboard itself, which then fetched the same aggregate again to
      // actually use it.
      const res = await fetch('/api/admin/session', { cache: 'no-store' });
      if (!res.ok) return;
      const session: SessionResponse = await res.json();
      setAuthenticated(session.authenticated === true);
      setFixture(session.fixture === true);
    } catch {
      // Leave unauthenticated; the login form is the correct fallback.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Reload rather than flipping local state: middleware rewrites an
        // unauthenticated deep link to /admin, so the browser is holding the
        // dashboard's payload. Reloading re-runs the gate with the new session
        // cookie and serves the page that was actually requested.
        window.location.reload();
        return;
      }

      // Only a 401 means the password was wrong. A 500 means the server is
      // misconfigured — ADMIN_PASSWORD or ADMIN_SESSION_SECRET missing — and
      // reporting that as "mot de passe incorrect" sends the operator off to
      // retype a password that was never the problem. The routes go to the
      // trouble of naming the missing variable; show it.
      if (res.status === 401) {
        setLoginError('Mot de passe incorrect');
      } else {
        const body = await res.json().catch(() => null);
        setLoginError(body?.error ?? `Erreur serveur (${res.status})`);
      }
    } catch {
      setLoginError('Erreur de connexion');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
          <h1 className="text-xl font-semibold mb-6 text-center">ArchiMap Admin</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe admin"
            aria-label="Mot de passe admin"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          {loginError && (
            <p className="text-red-500 text-sm mb-4">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Connexion…' : 'Connexion'}
          </button>
        </form>
      </div>
    );
  }

  const navItems = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/criteria', label: 'Critères' },
    { href: '/admin/data', label: 'Données' },
    { href: '/admin/ingestion', label: 'Ingestion' },
  ];

  return (
    <AdminContext.Provider value={{ authenticated, fixture }}>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar navigation */}
        <nav className="w-56 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <Link href="/admin" className="text-lg font-semibold text-gray-900">
              ArchiMap Admin
            </Link>
          </div>

          <div className="flex-1 py-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="p-4 border-t border-gray-200">
            <Link
              href="/map"
              className="block text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Retour au map
            </Link>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 p-6 overflow-auto">
          {/*
            A standing banner, not a toast. Every number below it comes from a
            fixture covering one département rather than from a database, and
            every write below it is discarded. That has to stay on screen for as
            long as it is true of the data — a notice that fades after three
            seconds is a notice the next person to look does not see.
          */}
          {fixture && (
            <div
              data-testid="fixture-banner"
              className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
            >
              <span aria-hidden className="mt-0.5 text-amber-600">⚠</span>
              <div className="text-sm text-amber-900">
                <strong className="font-semibold">Mode fixture (ARCHIMAP_FIXTURE=1)</strong> — aucune
                base de données n’est connectée. Les chiffres proviennent de{' '}
                <code className="font-mono text-xs">public/fixtures/</code> : ce sont de{' '}
                <strong>vraies données publiques</strong> (INSEE, DVF, ARCEP, Météo France…)
                capturées pour un seul département, et non des valeurs simulées. Les
                modifications sont appliquées en mémoire et perdues au redémarrage.
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </AdminContext.Provider>
  );
}
