import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { isFixtureMode, type FixtureAdminCriterion } from '@/lib/fixture';
import {
  FIXTURE_HEADER,
  deleteCriterion,
  fixtureCoverage,
  fixtureCriterion,
  fixtureWriteResult,
  patchCriterion,
} from '@/lib/fixture/admin';

export const runtime = 'nodejs';

/**
 * Columns a PUT may write. Anything else in the body is dropped, so a client
 * that round-trips a GET (which adds `coverage`) cannot smuggle it into an
 * UPDATE.
 */
const ALLOWED_FIELDS = [
  'name', 'name_en', 'category', 'description', 'unit', 'source',
  'last_updated', 'higher_is_better', 'color_scale_low', 'color_scale_mid',
  'color_scale_high', 'enabled', 'display_order', 'ingestion_type', 'api_config',
] as const;

/**
 * GET /api/admin/criteria/[id] — Get criterion detail
 */
export async function GET(
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
      const criterion = await fixtureCriterion(request, id);
      if (!criterion) {
        return NextResponse.json(
          { error: 'Criterion not found' },
          { status: 404, headers: FIXTURE_HEADER }
        );
      }
      const coverage = (await fixtureCoverage(request)).find((c) => c.criterion_id === id);
      return NextResponse.json(
        { ...criterion, coverage: coverage ?? null },
        { headers: FIXTURE_HEADER }
      );
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('criteria')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });
    }

    // Get coverage info
    const { data: coverage } = await supabase
      .from('criterion_coverage')
      .select('*')
      .eq('criterion_id', id)
      .single();

    return NextResponse.json({ ...data, coverage: coverage ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/criteria/[id] — Update criterion
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();

    const updateData: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Fixture mode: apply to the in-memory overlay and label the response as
    // unpersisted, so the edit screen can navigate away truthfully.
    if (isFixtureMode()) {
      const current = await fixtureCriterion(request, id);
      if (!current) {
        return NextResponse.json(
          { error: 'Criterion not found' },
          { status: 404, headers: FIXTURE_HEADER }
        );
      }
      patchCriterion(id, updateData as Partial<FixtureAdminCriterion>);
      return NextResponse.json(fixtureWriteResult({ ...current, ...updateData }), {
        headers: FIXTURE_HEADER,
      });
    }

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('criteria')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/criteria/[id] — Delete criterion (cascades to criterion_values)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    if (isFixtureMode()) {
      const current = await fixtureCriterion(request, id);
      if (!current) {
        return NextResponse.json(
          { error: 'Criterion not found' },
          { status: 404, headers: FIXTURE_HEADER }
        );
      }
      deleteCriterion(id);
      return NextResponse.json(fixtureWriteResult({ ok: true }), { headers: FIXTURE_HEADER });
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from('criteria')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
