import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/criteria/[id]/toggle — Toggle criterion enabled state
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = verifyAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  try {
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
