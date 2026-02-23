import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapView } from '@/components/Map/MapView';
import { createClient } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ insee: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { insee } = await params;
  const supabase = await createClient();

  const { data: commune } = await supabase
    .from('communes')
    .select('nom, code_departement')
    .eq('code', insee)
    .single();

  if (!commune) {
    return {
      title: 'Commune non trouvée - ArchiMap',
    };
  }

  // Fetch department and region
  const { data: dept } = await supabase
    .from('departements')
    .select('nom, code_region')
    .eq('code', commune.code_departement)
    .single();

  const { data: region } = dept ? await supabase
    .from('regions')
    .select('nom')
    .eq('code', dept.code_region)
    .single() : { data: null };

  const deptNom = dept?.nom || '';
  const regionNom = region?.nom || '';

  return {
    title: `${commune.nom} (${deptNom}) - ArchiMap`,
    description: `Analyse territoriale de ${commune.nom}, ${deptNom}, ${regionNom}. Consultez les critères de qualité de vie, coût, services et plus.`,
  };
}

export default async function CommunePage({ params }: PageProps) {
  const { insee } = await params;
  const supabase = await createClient();

  const { data: commune } = await supabase
    .from('communes')
    .select('code, nom, population, code_departement')
    .eq('code', insee)
    .single();

  if (!commune) {
    notFound();
  }

  // Fetch department
  const { data: dept } = await supabase
    .from('departements')
    .select('code, nom, code_region')
    .eq('code', commune.code_departement)
    .single();

  // Fetch region
  const { data: region } = dept ? await supabase
    .from('regions')
    .select('code, nom')
    .eq('code', dept.code_region)
    .single() : { data: null };

  return (
    <MapView
      initialLevel="communes"
      initialRegion={region ? { code: region.code, nom: region.nom } : undefined}
      initialDepartment={dept ? { code: dept.code, nom: dept.nom } : undefined}
      initialCommune={{
        code: commune.code,
        nom: commune.nom,
        population: commune.population
      }}
      showDetailPanel
    />
  );
}
