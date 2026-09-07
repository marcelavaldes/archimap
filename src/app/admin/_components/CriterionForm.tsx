'use client';

import Link from 'next/link';

/**
 * The criterion editor, shared by `criteria/[id]` and `criteria/new`.
 *
 * It used to live inside `criteria/[id]/page.tsx` as a second named export,
 * which `criteria/new/page.tsx` imported as `from '../[id]/page'`. That made
 * one route module a dependency of another route module: the "new" page pulled
 * in the edit page's component, its hooks and its data-fetching effect purely
 * to reach a form. Moving it into the App Router's private `_components`
 * folder leaves each page owning only its own route.
 */
export interface CriterionData {
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

interface CriterionFormProps {
  form: CriterionData;
  onChange: (data: CriterionData) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  error: string;
  isNew: boolean;
  /** Shown on success when the write did not reach a database (fixture mode). */
  notice?: string | null;
}

export function CriterionForm({
  form,
  onChange,
  onSubmit,
  saving,
  error,
  isNew,
  notice,
}: CriterionFormProps) {
  const update = (field: keyof CriterionData, value: unknown) => {
    onChange({ ...form, [field]: value });
  };

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>
      )}
      {notice && (
        <div className="bg-amber-50 text-amber-800 text-sm p-3 rounded-lg border border-amber-200">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {isNew && (
          <div>
            <label htmlFor="criterion-id" className="block text-sm font-medium text-gray-700 mb-1">ID (slug)</label>
            <input
              id="criterion-id"
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
          <label htmlFor="criterion-name" className="block text-sm font-medium text-gray-700 mb-1">Nom (FR)</label>
          <input
            id="criterion-name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="criterion-name-en" className="block text-sm font-medium text-gray-700 mb-1">Name (EN)</label>
          <input
            id="criterion-name-en"
            value={form.name_en}
            onChange={(e) => update('name_en', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="criterion-category" className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
          <select
            id="criterion-category"
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
          <label htmlFor="criterion-unit" className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
          <input
            id="criterion-unit"
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="criterion-order" className="block text-sm font-medium text-gray-700 mb-1">Ordre d&apos;affichage</label>
          <input
            id="criterion-order"
            type="number"
            value={form.display_order}
            onChange={(e) => update('display_order', parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="criterion-description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          id="criterion-description"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="criterion-source" className="block text-sm font-medium text-gray-700 mb-1">Source</label>
          <input
            id="criterion-source"
            value={form.source}
            onChange={(e) => update('source', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="criterion-ingestion" className="block text-sm font-medium text-gray-700 mb-1">Type d&apos;ingestion</label>
          <select
            id="criterion-ingestion"
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
        <span className="block text-sm font-medium text-gray-700 mb-2">Échelle de couleurs</span>
        <div className="flex items-center gap-4">
          <div>
            <label htmlFor="color-low" className="block text-xs text-gray-500 mb-1">Bas</label>
            <input
              id="color-low"
              type="color"
              value={form.color_scale_low}
              onChange={(e) => update('color_scale_low', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div>
            <label htmlFor="color-mid" className="block text-xs text-gray-500 mb-1">Milieu</label>
            <input
              id="color-mid"
              type="color"
              value={form.color_scale_mid}
              onChange={(e) => update('color_scale_mid', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div>
            <label htmlFor="color-high" className="block text-xs text-gray-500 mb-1">Haut</label>
            <input
              id="color-high"
              type="color"
              value={form.color_scale_high}
              onChange={(e) => update('color_scale_high', e.target.value)}
              className="w-12 h-8 rounded cursor-pointer"
            />
          </div>
          <div className="flex-1">
            <span className="block text-xs text-gray-500 mb-1">Aperçu</span>
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
