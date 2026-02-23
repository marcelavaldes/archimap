import { Metadata } from 'next';
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

  const { data: region } = await supabase
    .from('regions')
    .select('nom')
    .eq('code', dept.code_region)
    .single();

  return {
    title: `${dept.nom} - ArchiMap`,
    description: `Explorez les communes du département ${dept.nom} (${region?.nom || ''}) avec des données territoriales interactives.`,
  };
}

export default function DepartmentPage() {
  // For now, just show the basic map - deep linking will be added later
  return <MapView />;
}
