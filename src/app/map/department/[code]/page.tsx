import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapView } from '@/components/Map/MapView';
import { createClient } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from('departements')
    .select('nom, code_region')
    .eq('code', code)
    .single();

  if (!dept) {
    return {
      title: 'Département non trouvé - ArchiMap',
    };
  }

  // Fetch region name separately
  const { data: region } = await supabase
    .from('regions')
    .select('nom')
    .eq('code', dept.code_region)
    .single();

  const regionNom = region?.nom || '';

  return {
    title: `${dept.nom} - ArchiMap`,
    description: `Explorez les communes du département ${dept.nom} (${regionNom}) avec des données territoriales interactives.`,
  };
}

export default async function DepartmentPage({ params }: PageProps) {
  const { code } = await params;
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from('departements')
    .select('code, nom, code_region')
    .eq('code', code)
    .single();

  if (!dept) {
    notFound();
  }

  // Fetch region separately
  const { data: region } = await supabase
    .from('regions')
    .select('code, nom')
    .eq('code', dept.code_region)
    .single();

  return (
    <MapView
      initialLevel="communes"
      initialRegion={region ? { code: region.code, nom: region.nom } : undefined}
      initialDepartment={{ code: dept.code, nom: dept.nom }}
    />
  );
}
