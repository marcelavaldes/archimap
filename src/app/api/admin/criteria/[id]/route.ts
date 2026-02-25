import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/criteria/[id] — Get criterion detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
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
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();
    const supabase = createAdminClient();

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'name', 'name_en', 'category', 'description', 'unit', 'source',
      'last_updated', 'higher_is_better', 'color_scale_low', 'color_scale_mid',
      'color_scale_high', 'enabled', 'display_order', 'ingestion_type', 'api_config',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

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
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
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
