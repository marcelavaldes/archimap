'use client';

import { ChevronRight, Home } from 'lucide-react';
import { AdminLevel } from '@/types/geo';

export interface BreadcrumbItem {
  level: AdminLevel | 'france';
  code?: string;
  nom: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (index: number) => void;
}

export function Breadcrumb({ items, onNavigate }: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav className="bg-background border-b border-border px-4 py-3" aria-label="Fil d'Ariane">
      <ol className="flex items-center space-x-2 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = !isLast;

          return (
            <li key={`${item.level}-${item.code || 'france'}`} className="flex items-center">
              {index > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground mx-2" />
              )}

              {isClickable ? (
                <button
                  onClick={() => onNavigate(index)}
                  className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  {index === 0 && <Home className="h-4 w-4" />}
                  <span>{item.nom}</span>
                </button>
              ) : (
                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                  {index === 0 && <Home className="h-4 w-4" />}
                  <span>{item.nom}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
