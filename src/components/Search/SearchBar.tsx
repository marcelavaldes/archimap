'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MapPin, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

interface SearchResult {
  code: string;
  nom: string;
  code_departement: string;
  nom_departement: string;
  lng: number;
  lat: number;
}

interface SearchBarProps {
  className?: string;
  onSelect?: (result: SearchResult) => void;
}

export function SearchBar({ className = '', onSelect }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Search API call
  const searchCommunes = useCallback(async (searchTerm: string) => {
    if (searchTerm.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();

      if (data.results) {
        setResults(data.results);
        setIsOpen(true);
      } else {
        setResults([]);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= 2) {
      debounceRef.current = setTimeout(() => {
        searchCommunes(query);
      }, 200);
    } else {
      setResults([]);
      setIsOpen(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, searchCommunes]);

  // Handle result selection
  const handleSelect = useCallback((result: SearchResult) => {
    setQuery(result.nom);
    setIsOpen(false);
    setSelectedIndex(-1);

    if (onSelect) {
      onSelect(result);
    } else {
      // Navigate to commune page, preserving criterion parameter
      const params = new URLSearchParams(searchParams.toString());
      const queryString = params.toString() ? `?${params.toString()}` : '';
      router.push(`/map/commune/${result.code}${queryString}`);
    }
  }, [onSelect, router, searchParams]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, results, selectedIndex, handleSelect]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear search
  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Rechercher une commune..."
          className="w-full pl-9 pr-9 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
          autoComplete="off"
          aria-label="Rechercher une commune"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        ) : query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
            aria-label="Effacer la recherche"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && results.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg overflow-hidden z-50"
          role="listbox"
        >
          <ul className="max-h-80 overflow-y-auto">
            {results.map((result, index) => (
              <li
                key={result.code}
                role="option"
                aria-selected={index === selectedIndex}
                className={`px-3 py-2 cursor-pointer flex items-start gap-3 transition-colors ${
                  index === selectedIndex
                    ? 'bg-primary/10'
                    : 'hover:bg-accent'
                }`}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{result.nom}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {result.nom_departement} ({result.code_departement})
                  </div>
                </div>
                <div className="ml-auto text-xs text-muted-foreground font-mono">
                  {result.code}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No results message */}
      {isOpen && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground z-50">
          Aucune commune trouvée pour "{query}"
        </div>
      )}
    </div>
  );
}
