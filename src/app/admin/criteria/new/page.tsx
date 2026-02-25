'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CriterionForm } from '../[id]/page';

const defaultForm: {
  id: string;
  name: string;
  name_en: string;
  category: string;
  description: string;
  unit: string;
  source: string;
  last_updated: string | null;
  higher_is_better: boolean;
  color_scale_low: string;
  color_scale_mid: string;
  color_scale_high: string;
  enabled: boolean;
  display_order: number;
  ingestion_type: string;
  api_config: Record<string, string> | null;
} = {
  id: '',
  name: '',
  name_en: '',
  category: 'climate',
  description: '',
  unit: '',
  source: '',
  last_updated: null,
  higher_is_better: true,
  color_scale_low: '#22c55e',
  color_scale_mid: '#eab308',
  color_scale_high: '#dc2626',
  enabled: true,
  display_order: 0,
  ingestion_type: 'manual',
  api_config: null,
};

export default function NewCriterionPage() {
  const router = useRouter();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/admin/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur de création');
      }

      router.push('/admin/criteria');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/criteria" className="text-sm text-gray-500 hover:text-gray-700">&larr; Retour</Link>
        <h1 className="text-2xl font-semibold text-gray-900">Nouveau critère</h1>
      </div>

      <CriterionForm
        form={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        saving={saving}
        error={error}
        isNew={true}
      />
    </div>
  );
}
