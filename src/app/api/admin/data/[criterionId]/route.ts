import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * GET /api/admin/data/[criterionId] — Paginated values for a criterion
 * Query params: ?page=1&limit=50&search=montpellier
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const search = searchParams.get('search') ?? '';

  try {
    const supabase = createAdminClient();
    const offset = (page - 1) * limit;

    let query = supabase
      .from('criterion_values')
      .select('*, communes!inner(nom)', { count: 'exact' })
      .eq('criterion_id', criterionId)
      .order('score', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike('communes.nom', `%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/data/[criterionId] — Delete all values for a criterion
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  try {
    const supabase = createAdminClient();

    const { count, error } = await supabase
      .from('criterion_values')
      .delete({ count: 'exact' })
      .eq('criterion_id', criterionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: count ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
