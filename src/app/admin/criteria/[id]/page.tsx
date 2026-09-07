'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminFetch, errorMessage, unpersistedNote } from '@/lib/admin/client';
import { CriterionForm, type CriterionData } from '../../_components/CriterionForm';
import { ErrorPanel } from '../../_components/ErrorPanel';

export default function CriterionEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<CriterionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setForm(await adminFetch<CriterionData>(`/api/admin/criteria/${id}`));
    } catch (err) {
      // The route's own message, not a blanket "Critère introuvable": a 500
      // from a missing service-role key is not a missing criterion, and telling
      // the operator it is sends them looking in the wrong place.
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    setSaving(true);
    setError('');
    setNotice(null);

    try {
      const result = await adminFetch<unknown>(`/api/admin/criteria/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      // A write that did not reach a database must not navigate away as though
      // it had. Stay on the form and say where the change actually went.
      const note = unpersistedNote(result);
      if (note) {
        setNotice(note);
        return;
      }

      router.push('/admin/criteria');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="animate-pulse text-gray-400">Chargement...</div>;
  if (loadError) return <ErrorPanel message={loadError} onRetry={load} />;
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
        notice={notice}
      />
    </div>
  );
}
