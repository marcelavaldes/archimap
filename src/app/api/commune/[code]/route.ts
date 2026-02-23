import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'edge';

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { code } = await params;

  if (!code) {
    return NextResponse.json({ error: 'Commune code is required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    // Fetch commune basic info
    const { data: commune, error: communeError } = await supabase
      .from('communes')
      .select('code, nom, population, code_departement')
      .eq('code', code)
      .single();

    if (communeError || !commune) {
      return NextResponse.json({ error: 'Commune not found' }, { status: 404 });
    }

    // Fetch department info
    const { data: dept } = await supabase
      .from('departements')
      .select('nom, code_region')
      .eq('code', commune.code_departement)
      .single();

    // Fetch region info
    const { data: region } = dept ? await supabase
      .from('regions')
      .select('nom')
      .eq('code', dept.code_region)
      .single() : { data: null };

    // Fetch all criterion values for this commune
    const { data: criterionValues, error: criteriaError } = await supabase
      .from('criterion_values')
      .select('criterion_id, value, score, rank_national, rank_departement')
      .eq('commune_code', code);

    if (criteriaError) {
      console.error('Error fetching criteria:', criteriaError);
    }

    // Transform criterion values into a map
    const criteria: Record<string, {
      value: number;
      score: number;
      rankNational?: number;
      rankDepartement?: number;
    }> = {};

    if (criterionValues) {
      for (const cv of criterionValues) {
        criteria[cv.criterion_id] = {
          value: cv.value,
          score: cv.score,
          rankNational: cv.rank_national ?? undefined,
          rankDepartement: cv.rank_departement ?? undefined,
        };
      }
    }

    return NextResponse.json({
      code: commune.code,
      nom: commune.nom,
      population: commune.population,
      departement: dept ? {
        code: commune.code_departement,
        nom: dept.nom,
      } : null,
      region: region ? {
        code: dept?.code_region,
        nom: region.nom,
      } : null,
      criteria,
    });
  } catch (error) {
    console.error('Error in commune API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
