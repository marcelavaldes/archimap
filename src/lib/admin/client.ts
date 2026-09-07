/**
 * Client-side helper for talking to /api/admin.
 *
 * Every admin screen was written as
 * `fetch(url).then(r => r.json()).then(setState)`. That is wrong in one
 * specific and damaging way: the admin routes answer failures with a JSON body
 * `{ error: "..." }` and a 4xx/5xx status, so an error parses perfectly and
 * lands in component state as if it were the payload. The next line is
 * `criteria.map(...)` or `data.coverage.map(...)`, which throws on an object,
 * React unmounts the subtree, and the operator gets a blank white pane with no
 * message on screen and no clue in the UI. That is what "the admin panel is
 * broken" looked like from the outside: not a rendering bug, an unread status
 * code.
 *
 * So: status first, body second, and the server's own message survives to the
 * screen. Screens using adminFetch render an error state instead of nothing.
 */

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

/**
 * Read a response body without assuming it is JSON.
 *
 * A framework-level 500 (an unset SUPABASE_SERVICE_ROLE_KEY throwing inside a
 * handler, say) comes back as an HTML error page. `res.json()` on that throws a
 * SyntaxError, which used to be reported to the operator as a network problem —
 * pointing at the wrong thing entirely.
 */
async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: `${res.status} ${res.statusText || 'Erreur serveur'}` };
  }
}

function messageFor(body: unknown, res: Response): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  if (res.status === 401) return 'Session expirée — reconnectez-vous.';
  return `Erreur ${res.status}`;
}

/** GET/POST/… an admin route, throwing AdminApiError on any non-2xx. */
export async function adminFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new AdminApiError('Erreur de connexion au serveur', 0);
  }

  const body = await readBody(res);
  if (!res.ok) throw new AdminApiError(messageFor(body, res), res.status);
  return body as T;
}

/** Turn anything thrown into something worth putting on screen. */
export function errorMessage(err: unknown): string {
  if (err instanceof AdminApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Erreur inconnue';
}

/**
 * The shape every mutating admin route returns in fixture mode.
 *
 * `persisted: false` is the contract: a write that did not reach a database
 * must say so, and the caller must show it. Silence here would let a developer
 * conclude from a working-looking screen that the write path works.
 */
export interface FixtureWriteMeta {
  fixture?: boolean;
  persisted?: boolean;
  fixtureNote?: string;
}

/** The note to show after a write, or null when the write really was persisted. */
export function unpersistedNote(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const meta = result as FixtureWriteMeta;
  return meta.persisted === false ? meta.fixtureNote ?? 'Non enregistré.' : null;
}
