import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/ingestion/[criterionId]/run — Trigger re-ingestion
 * Note: This is a placeholder that reports the script to run.
 * Full inline execution would require importing each ingestion script,
 * which are currently designed as standalone Bun scripts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  try {
    const supabase = createAdminClient();

    const { data: criterion, error } = await supabase
      .from('criteria')
      .select('id, name, ingestion_type, api_config')
      .eq('id', criterionId)
      .single();

    if (error || !criterion) {
      return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });
    }

    if (criterion.ingestion_type !== 'api') {
      return NextResponse.json(
        { error: 'Criterion is not API-based' },
        { status: 400 }
      );
    }

    const apiConfig = criterion.api_config as { script?: string; description?: string } | null;

    if (!apiConfig?.script) {
      return NextResponse.json(
        { error: 'No ingestion script configured' },
        { status: 400 }
      );
    }

    // For now, return the script info for manual execution
    // A full implementation would spawn a child process or import the script
    return NextResponse.json({
      status: 'manual_required',
      criterionId: criterion.id,
      criterionName: criterion.name,
      script: apiConfig.script,
      description: apiConfig.description ?? '',
      command: `bun run scripts/ingest/${apiConfig.script}`,
      message: `Run the ingestion script manually: bun run scripts/ingest/${apiConfig.script}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
