'use client';

/**
 * The admin panel's "this did not load" state.
 *
 * Every screen needed one and none of them had one. The pattern was
 * `fetch().then(r => r.json()).then(setState)`, which cannot distinguish a
 * payload from an `{ error }` body, so a 401 or a 500 was rendered as if it
 * were data — usually by crashing on `.map` and leaving a blank pane. With
 * adminFetch() throwing on status, every screen has something to show, and what
 * it shows is the server's own message rather than a generic apology.
 *
 * `_components` (leading underscore) is a private folder: the App Router does
 * not route it. Shared pieces went in `page.tsx` files before, which meant
 * `criteria/new` imported the whole `criteria/[id]` route module to get one
 * form.
 */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="text-sm font-medium text-red-800">Erreur de chargement</div>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Neutral "there is nothing here yet" state, distinct from "it failed". */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm text-gray-500">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
