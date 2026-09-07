import { NextRequest } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { ingestionRunners } from '@/lib/admin/ingestion-runners';
import { isFixtureMode, type FixtureAdminCriterion } from '@/lib/fixture';
import { NOT_PERSISTED, fixtureCriterion } from '@/lib/fixture/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/admin/ingestion/[criterionId]/run
 * Executes ingestion inline and streams logs via SSE.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  const fixture = isFixtureMode();

  // Validate criterion exists and is API-type.
  //
  // Wrapped: createAdminClient() throws outright when SUPABASE_SERVICE_ROLE_KEY
  // is unset, and this used to be outside any try. The framework turned that
  // into an HTML 500, the ingestion page's `await res.json()` choked on the
  // HTML, and the operator was told "Connection lost" for what is a missing
  // environment variable.
  let criterion: Pick<FixtureAdminCriterion, 'id' | 'name' | 'ingestion_type' | 'api_config'> | null;
  try {
    if (fixture) {
      criterion = await fixtureCriterion(request, criterionId);
    } else {
      const { data } = await createAdminClient()
        .from('criteria')
        .select('id, name, ingestion_type, api_config')
        .eq('id', criterionId)
        .single();
      criterion = data;
    }
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : 'Internal error', 500);
  }

  if (!criterion) return jsonError('Criterion not found', 404);
  if (criterion.ingestion_type !== 'api') return jsonError('Criterion is not API-based', 400);

  const runner = ingestionRunners[criterionId];
  if (!runner) return jsonError(`No ingestion runner for ${criterionId}`, 400);

  // Stream logs via SSE
  const encoder = new TextEncoder();
  const criterionName = criterion.name;
  const apiConfig = criterion.api_config;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)
          );
        } catch {
          // Stream may be closed
        }
      };

      const log = (message: string) => send('log', { message });

      send('start', { criterionId, criterionName });
      log(`Starting ingestion for: ${criterionName}`);
      log('');

      // Fixture mode stops here, before the runner. A runner fetches from a
      // live open-data API and then upserts through the service-role key — the
      // fetch would work and the write would not, so the honest thing is not to
      // start. The SSE transport, the log console and the result banner are all
      // still exercised; only the work is skipped, and the console says which.
      if (fixture) {
        log('=== MODE FIXTURE — DRY RUN ===');
        log(`Runner disponible : ${apiConfig?.script ?? criterionId}`);
        log(`Source : ${apiConfig?.description ?? 'open data'}`);
        log('');
        log('Aucun appel réseau, aucune écriture en base.');
        log(NOT_PERSISTED);
        send('done', {
          inserted: 0,
          errors: 0,
          communes: 0,
          persisted: false,
          fixtureNote: `Dry run (mode fixture) — le runner « ${apiConfig?.script ?? criterionId} » n’a pas été exécuté.`,
        });
        controller.close();
        return;
      }

      const supabase = createAdminClient();

      try {
        const result = await runner(log);

        log('');
        log(`=== COMPLETE ===`);
        log(`Inserted: ${result.inserted} records`);
        log(`Errors: ${result.errors}`);
        log(`Communes: ${result.communes}`);

        // Update last_updated on the criterion
        await supabase
          .from('criteria')
          .update({ last_updated: new Date().toISOString().split('T')[0] })
          .eq('id', criterionId);

        send('done', {
          inserted: result.inserted,
          errors: result.errors,
          communes: result.communes,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log(`\nERROR: ${message}`);
        send('error', { message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
