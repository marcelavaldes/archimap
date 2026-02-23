import { Metadata } from 'next';
import { MapView } from '@/components/Map/MapView';
import { createClient } from '@/lib/supabase/server';

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const supabase = await createClient();

  const { data: region } = await supabase
    .from('regions')
    .select('nom')
    .eq('code', code)
    .single();

  if (!region) {
    return {
      title: 'Région non trouvée - ArchiMap',
    };
  }

  return {
    title: `${region.nom} - ArchiMap`,
    description: `Explorez les départements et communes de la région ${region.nom} avec des données territoriales interactives.`,
  };
}

export default function RegionPage() {
  // For now, just show the basic map - deep linking will be added later
  return <MapView />;
}
