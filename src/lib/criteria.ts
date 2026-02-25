'use client';

import { useState, useEffect } from 'react';
import type { Criterion } from '@/types/criteria';

/**
 * Client-side hook to fetch enabled criteria from /api/criteria.
 * Caches in module-level variable to avoid refetching across components.
 */
let cachedCriteria: Record<string, Criterion> | null = null;
let fetchPromise: Promise<Record<string, Criterion>> | null = null;

async function fetchCriteriaFromAPI(): Promise<Record<string, Criterion>> {
  if (cachedCriteria) return cachedCriteria;
  if (fetchPromise) return fetchPromise;

  fetchPromise = fetch('/api/criteria')
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch criteria: ${res.status}`);
      return res.json();
    })
    .then(data => {
      cachedCriteria = data;
      fetchPromise = null;
      return data;
    })
    .catch(err => {
      fetchPromise = null;
      throw err;
    });

  return fetchPromise;
}

export function useCriteria(): {
  criteria: Record<string, Criterion> | null;
  loading: boolean;
  error: string | null;
} {
  const [criteria, setCriteria] = useState<Record<string, Criterion> | null>(cachedCriteria);
  const [loading, setLoading] = useState(!cachedCriteria);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedCriteria) {
      setCriteria(cachedCriteria);
      setLoading(false);
      return;
    }

    fetchCriteriaFromAPI()
      .then(data => {
        setCriteria(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { criteria, loading, error };
}

/**
 * Invalidate the client-side cache (e.g., after admin changes)
 */
export function invalidateCriteriaCache() {
  cachedCriteria = null;
  fetchPromise = null;
}
