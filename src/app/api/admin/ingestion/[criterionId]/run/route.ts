import { NextRequest } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { ingestionRunners } from '@/lib/admin/ingestion-runners';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/admin/ingestion/[criterionId]/run
 * Executes ingestion inline and streams logs via SSE.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  // Validate criterion exists and is API-type
  const supabase = createAdminClient();
  const { data: criterion, error } = await supabase
    .from('criteria')
    .select('id, name, ingestion_type, api_config')
    .eq('id', criterionId)
    .single();

  if (error || !criterion) {
    return new Response(
      JSON.stringify({ error: 'Criterion not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (criterion.ingestion_type !== 'api') {
    return new Response(
      JSON.stringify({ error: 'Criterion is not API-based' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const runner = ingestionRunners[criterionId];
  if (!runner) {
    return new Response(
      JSON.stringify({ error: `No ingestion runner for ${criterionId}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Stream logs via SSE
  const encoder = new TextEncoder();

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

      send('start', { criterionId, criterionName: criterion.name });
      log(`Starting ingestion for: ${criterion.name}`);
      log('');

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
