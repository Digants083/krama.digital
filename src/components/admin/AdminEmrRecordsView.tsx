import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, BrainCircuit, FileHeart, Loader2, LogOut, RefreshCw, Search } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminEmrRecordsViewProps {
  adminToken: string;
  onBack: () => void;
  onLogout: () => void;
}

interface PageResult {
  total: number;
  items: Array<Record<string, any>>;
}

const PAGE_SIZE = 20;

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const display = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

function SoapBlock({ title, value }: { title: string; value: unknown }) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-sm font-bold uppercase tracking-wide text-primary">{title}</h4>
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

export default function AdminEmrRecordsView({ adminToken, onBack, onLogout }: AdminEmrRecordsViewProps) {
  const [result, setResult] = useState<PageResult>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const fetchRecords = async (nextPage = 0, query = search) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextPage * PAGE_SIZE),
      });
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(apiUrl(`/api/admin/emr-records?${params}`), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not load EMR records");
      setResult({ total: body.total || 0, items: body.items || [] });
      setPage(nextPage);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load EMR records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecords(0, "");
    // The view mounts only after the admin clicks EMR Records.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void fetchRecords(0, search);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><FileHeart className="h-5 w-5 text-primary" /> EMR Records</h1>
              <p className="text-xs text-slate-500">Approved EMRs and model-learning comparisons</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchRecords(page, search)} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
            <Button variant="outline" size="sm" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" /> Logout</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col justify-between gap-3 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div><h2 className="font-semibold text-slate-900">{result.total} approved EMRs</h2><p className="mt-1 text-xs text-slate-500">Loaded only after opening this section, 20 records per page.</p></div>
          <form onSubmit={submitSearch} className="flex w-full gap-2 sm:max-w-lg"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clinic, patient or encounter" /><Button type="submit" variant="outline" disabled={loading}><Search className="h-4 w-4" /></Button></form>
        </div>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <div className="flex min-h-72 items-center justify-center rounded-2xl border bg-white"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : result.items.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-white text-slate-500"><FileHeart className="mb-3 h-10 w-10 text-slate-300" /><p>No approved EMRs found</p></div>
        ) : (
          <div className="space-y-5">
            {result.items.map((record) => {
              const finalEmr = record.approved_emr || {};
              return (
                <article key={record.encounter_id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <div className="flex flex-col justify-between gap-3 border-b bg-gradient-to-r from-slate-50 to-white p-5 sm:flex-row">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-slate-900">{display(record.clinic_name)}</h3><span className="rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">Doctor approved</span><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{record.changed_field_count || 0} changes</span></div>
                      <p className="mt-1 text-sm text-slate-600">Patient: {display(record.patient_name)} · {display(record.patient_id)}</p>
                      <p className="mt-1 text-xs text-slate-500">Encounter: {display(record.encounter_id)} · Model: {display(record.model_name)}</p>
                    </div>
                    <div className="text-xs text-slate-500 sm:text-right"><div>Approved: {formatDate(record.approved_at)}</div><div>Approved by: {display(record.approved_by)}</div><div>Doctor edit saves: {record.doctor_edit_events || 0}</div></div>
                  </div>

                  <div className="grid gap-5 p-5 xl:grid-cols-[1.35fr_0.65fr]">
                    <div>
                      <div className="mb-3 flex items-center gap-2"><FileHeart className="h-5 w-5 text-primary" /><h3 className="font-bold text-slate-900">Final Approved EMR</h3></div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <SoapBlock title="Subjective" value={finalEmr.subjective} />
                        <SoapBlock title="Objective" value={finalEmr.objective} />
                        <SoapBlock title="Assessment" value={finalEmr.assessment} />
                        <SoapBlock title="Plan" value={finalEmr.plan} />
                      </div>
                      <details className="mt-3 rounded-xl border bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold">View complete approved EMR JSON</summary><pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(finalEmr, null, 2)}</pre></details>
                    </div>

                    <aside className="space-y-3">
                      <div className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-amber-700" /><h3 className="font-bold text-slate-900">Model Learning</h3></div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <h4 className="text-sm font-semibold text-amber-950">Doctor corrections</h4>
                        {record.changes?.length ? <div className="mt-3 space-y-2">{record.changes.slice(0, 10).map((change: any, index: number) => <div key={`${change.field}-${index}`} className="rounded-lg bg-white p-3 text-xs"><div className="font-semibold text-slate-800">{change.field}</div><div className="mt-1 text-red-700">AI: {display(typeof change.generated === "object" ? JSON.stringify(change.generated) : change.generated)}</div><div className="mt-1 text-green-700">Final: {display(typeof change.approved === "object" ? JSON.stringify(change.approved) : change.approved)}</div></div>)}</div> : <p className="mt-2 text-sm text-slate-600">No clinical field changes detected.</p>}
                      </div>
                      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Conversation transcript</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{display(record.transcript)}</p></details>
                      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Original AI-generated EMR</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(record.generated_emr || {}, null, 2)}</pre></details>
                      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Approved patient summary</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{JSON.stringify(record.approved_patient_summary || {}, null, 2)}</pre></details>
                    </aside>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between"><p className="text-sm text-slate-500">Showing {result.total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, result.total)} of {result.total}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => void fetchRecords(page - 1, search)}>Previous</Button><Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= result.total || loading} onClick={() => void fetchRecords(page + 1, search)}>Next</Button></div></div>
      </main>
    </div>
  );
}
