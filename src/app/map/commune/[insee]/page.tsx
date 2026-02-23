import { Metadata } from 'next';
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

  return {
    title: `${commune.nom} (${dept?.nom || ''}) - ArchiMap`,
    description: `Analyse territoriale de ${commune.nom}, ${dept?.nom || ''}, ${region?.nom || ''}. Consultez les critères de qualité de vie, coût, services et plus.`,
  };
}

export default function CommunePage() {
  // For now, just show the basic map - deep linking will be added later
  return <MapView />;
}
