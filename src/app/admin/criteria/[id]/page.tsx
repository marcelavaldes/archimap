'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface CriterionData {
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
}

export default function CriterionEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<CriterionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/admin/criteria/${id}`)
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        setForm(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Critère introuvable');
        setLoading(false);
      });
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/admin/criteria/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur de sauvegarde');
      }

      router.push('/admin/criteria');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="animate-pulse text-gray-400">Chargement...</div>;
  if (error && !form) return <div className="text-red-500">{error}</div>;
  if (!form) return null;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/criteria" className="text-sm text-gray-500 hover:text-gray-700">&larr; Retour</Link>
        <h1 className="text-2xl font-semibold text-gray-900">Éditer: {form.name}</h1>
      </div>

      <CriterionForm
        form={form}
        onChange={setForm}
        onSubmit={handleSubmit}
        saving={saving}
        error={error}
        isNew={false}
      />
    </div>
  );
}

interface CriterionFormProps {
  form: CriterionData;
  onChange: (data: CriterionData) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string;
  isNew: boolean;
}

export function CriterionForm({ form, onChange, onSubmit, saving, error, isNew }: CriterionFormProps) {
  const update = (field: keyof CriterionData, value: unknown) => {
    onChange({ ...form, [field]: value });
  };

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      {error && (
        <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {isNew && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ID (slug)</label>
            <input
              value={form.id}
              onChange={(e) => update('id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              required
              pattern="[a-zA-Z][a-zA-Z0-9]*"
              title="camelCase identifier"
            />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nom (FR)</label>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name (EN)</label>
          <input
            value={form.name_en}
            onChange={(e) => update('name_en', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
          <select
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="climate">Climat</option>
            <option value="cost">Coût</option>
            <option value="services">Services</option>
            <option value="quality">Qualité</option>
            <option value="employment">Emploi</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
          <input
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ordre d'affichage</label>
          <input
            type="number"
            value={form.display_order}
            onChange={(e) => update('display_order', parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
          <input
            value={form.source}
            onChange={(e) => update('source', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type d'ingestion</label>
          <select
            value={form.ingestion_type}
            onChange={(e) => update('ingestion_type', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="manual">Manuel</option>
            <option value="api">API</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.higher_is_better}
            onChange={(e) => update('higher_is_better', e.target.checked)}
            className="rounded"
          />
          Plus élevé = meilleur
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
            className="rounded"
          />
          Activé
        </label>
      </div>

      {/* Color scale */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Échelle de couleurs</label>
        <div className="flex items-center gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bas</label>
            <input
              type="color"
              value={form.color_scale_low}
              onChange={(e) => update('color_scale_low', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Milieu</label>
            <input
              type="color"
              value={form.color_scale_mid}
              onChange={(e) => update('color_scale_mid', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Haut</label>
            <input
              type="color"
              value={form.color_scale_high}
              onChange={(e) => update('color_scale_high', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Aperçu</label>
            <div
              className="h-8 rounded-lg"
              style={{
                background: `linear-gradient(90deg, ${form.color_scale_low}, ${form.color_scale_mid}, ${form.color_scale_high})`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <Link
          href="/admin/criteria"
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Annuler
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Sauvegarde...' : 'Sauvegarder'}
        </button>
      </div>
    </form>
  );
}
