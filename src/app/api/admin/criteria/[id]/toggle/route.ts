import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode } from '@/lib/fixture';
import {
  FIXTURE_HEADER,
  fixtureCriterion,
  fixtureWriteResult,
  patchCriterion,
} from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/criteria/[id]/toggle — Toggle criterion enabled state
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    // Fixture mode short-circuit — see src/lib/fixture/admin.ts. No-op unless
    // ARCHIMAP_FIXTURE=1, so the Supabase path below is unchanged in
    // production. Inside the try so an unbuilt fixture reports the message that
    // tells you to run `bun run fixture:build`.
    if (isFixtureMode()) {
      const current = await fixtureCriterion(request, id);
      if (!current) {
        return NextResponse.json(
          { error: 'Criterion not found' },
          { status: 404, headers: FIXTURE_HEADER }
        );
      }
      const enabled = !current.enabled;
      patchCriterion(id, { enabled });
      return NextResponse.json(fixtureWriteResult({ ...current, enabled }), {
        headers: FIXTURE_HEADER,
      });
    }

    const supabase = createAdminClient();

    // Get current state
    const { data: current, error: fetchError } = await supabase
      .from('criteria')
      .select('enabled')
      .eq('id', id)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });
    }

    // Toggle
    const { data, error } = await supabase
      .from('criteria')
      .update({ enabled: !current.enabled })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
