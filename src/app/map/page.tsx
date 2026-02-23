import { Metadata } from 'next';
import { MapView } from '@/components/Map/MapView';

export const metadata: Metadata = {
  title: 'ArchiMap - Carte de France',
  description: 'Explorez les régions, départements et communes de France avec des données territoriales interactives.',
};

export default function MapPage() {
  return <MapView />;
}
