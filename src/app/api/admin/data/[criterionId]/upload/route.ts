import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/admin/supabase';
import { normalizeToScore, calculateRanks, upsertCriterionValues, type CriterionRecord } from '@/lib/admin/scoring';
import { isFixtureMode } from '@/lib/fixture';
import { FIXTURE_HEADER, fixtureCriterion, fixtureWriteResult } from '@/lib/fixture/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/data/[criterionId]/upload — Upload CSV data
 * Expects multipart/form-data with a 'file' field containing CSV.
 * CSV must have columns: commune_code, value (score is optional, will be calculated)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ criterionId: string }> }
) {
  const authError = await verifyAdmin(request);
  if (authError) return authError;

  const { criterionId } = await params;

  try {
    // Fixture mode short-circuit — see src/lib/fixture/admin.ts. The parsing
    // and scoring below run for real; only the final upsert is skipped, so the
    // half of this handler worth exercising locally (header detection, row
    // rejection, normalizeToScore, calculateRanks) is exercised, and the
    // response says plainly that nothing was written.
    let criterion: { id: string; higher_is_better: boolean; source: string } | null = null;

    if (isFixtureMode()) {
      const row = await fixtureCriterion(request, criterionId);
      if (!row) {
        return NextResponse.json(
          { error: 'Criterion not found' },
          { status: 404, headers: FIXTURE_HEADER }
        );
      }
      criterion = { id: row.id, higher_is_better: row.higher_is_better, source: row.source };
    } else {
      const supabase = createAdminClient();

      // Verify criterion exists
      const { data, error: critError } = await supabase
        .from('criteria')
        .select('id, higher_is_better, source')
        .eq('id', criterionId)
        .single();

      if (critError || !data) {
        return NextResponse.json({ error: 'Criterion not found' }, { status: 404 });
      }
      criterion = data;
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.trim().split('\n');

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const codeIdx = header.indexOf('commune_code');
    const valueIdx = header.indexOf('value');
    const scoreIdx = header.indexOf('score');

    if (codeIdx === -1 || valueIdx === -1) {
      return NextResponse.json(
        { error: 'CSV must have commune_code and value columns' },
        { status: 400 }
      );
    }

    // Parse rows
    const rows: { commune_code: string; value: number; score?: number }[] = [];
    const parseErrors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const commune_code = cols[codeIdx];
      const value = parseFloat(cols[valueIdx]);

      if (!commune_code || isNaN(value)) {
        if (parseErrors.length < 5) {
          parseErrors.push(`Row ${i + 1}: invalid commune_code or value`);
        }
        continue;
      }

      const row: { commune_code: string; value: number; score?: number } = { commune_code, value };
      if (scoreIdx !== -1 && cols[scoreIdx]) {
        const score = parseFloat(cols[scoreIdx]);
        if (!isNaN(score)) row.score = score;
      }

      rows.push(row);
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid data rows found', parseErrors },
        { status: 400 }
      );
    }

    // Calculate scores if not provided
    const allValues = rows.map(r => r.value);
    const valueMap = new Map(rows.map(r => [r.commune_code, r.value]));
    const ranks = calculateRanks(valueMap, criterion.higher_is_better);

    const records: CriterionRecord[] = rows.map(r => ({
      commune_code: r.commune_code,
      criterion_id: criterionId,
      value: r.value,
      score: r.score ?? normalizeToScore(r.value, allValues, criterion.higher_is_better),
      rank_national: ranks.get(r.commune_code) ?? 0,
      source: criterion.source,
      source_date: new Date().toISOString().split('T')[0],
    }));

    if (isFixtureMode()) {
      return NextResponse.json(
        fixtureWriteResult({
          total: rows.length,
          inserted: 0,
          validated: records.length,
          errors: 0,
          parseErrors,
          sampleErrors: [],
        }),
        { headers: FIXTURE_HEADER }
      );
    }

    const result = await upsertCriterionValues(records);

    return NextResponse.json({
      total: rows.length,
      inserted: result.inserted,
      errors: result.errors,
      parseErrors,
      sampleErrors: result.sampleErrors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
