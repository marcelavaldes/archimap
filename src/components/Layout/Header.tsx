'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface HeaderProps {
  onDarkModeToggle?: (isDark: boolean) => void;
}

export function Header({ onDarkModeToggle }: HeaderProps) {
  const [isDark, setIsDark] = useState(false);
  const pathname = usePathname();

  const toggleDarkMode = () => {
    const newValue = !isDark;
    setIsDark(newValue);
    onDarkModeToggle?.(newValue);
    document.documentElement.classList.toggle('dark', newValue);
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background gap-4">
      <div className="flex items-center gap-3 flex-shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">
          ArchiMap
        </h1>
        <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-secondary hidden sm:inline">
          France
        </span>
      </div>

      {/* Search placeholder - will re-add later */}
      <div className="flex-1 max-w-md">
        <div className="w-full h-9 bg-secondary/30 rounded-lg flex items-center justify-center text-sm text-muted-foreground">
          Recherche (bientôt)
        </div>
      </div>

      <div className="flex items-center gap-4 flex-shrink-0">
        {pathname?.startsWith('/admin') ? null : (
          <Link
            href="/admin"
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
            aria-label="Administration"
            title="Administration"
          >
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        )}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg hover:bg-secondary transition-colors"
          aria-label={isDark ? 'Activer le mode clair' : 'Activer le mode sombre'}
        >
          {isDark ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
