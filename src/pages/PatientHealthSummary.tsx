import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Apple, ArrowLeft, Building2, CalendarDays, ChevronDown, ClipboardList, ListChecks, Sparkles, Stethoscope } from "lucide-react";
import { apiUrl } from "@/lib/api";

type Visit = {
  id: number;
  clinic_name: string;
  doctor_name?: string | null;
  date: string;
  time: string;
  diagnosis?: string | null;
  notes?: string | null;
  summary?: string | null;
  summary_status: string;
};

type SummaryData = {
  overview: { total_visits: number; clinics_visited: number; approved_ehr_count: number; summary: string };
  visits: Visit[];
  ehr_summaries: Array<{
    encounter_id: string;
    clinic_name: string;
    approved_at?: string | null;
    summary: {
      visit_overview?: string | null;
      medicines?: string[];
      tests?: string[];
      diet_advice?: string[];
      doctor_suggestions?: string[];
      instructions?: string[];
      follow_up?: string | null;
      warning_signs?: string[];
    };
  }>;
};

const getPatientId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.patient_id || user.id || "";
  } catch { return ""; }
};

const visitDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export default function PatientHealthSummary() {
  const patientId = useMemo(getPatientId, []);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openVisit, setOpenVisit] = useState<number | null>(null);

  useEffect(() => {
    if (!patientId) { setError("Please sign in again to view your summary."); setLoading(false); return; }
    const controller = new AbortController();
    fetch(apiUrl(`/api/patient-health/summary?patient_id=${encodeURIComponent(patientId)}`), { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Could not load summary"); return body; })
      .then(setData)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "Could not load summary"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [patientId]);

  return (
    <div className="min-h-screen bg-transparent">
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <header className="flex items-center gap-3">
          <Link to="/patient" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/80 text-[#17312d]" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Your health</p><h1 className="font-display text-2xl font-bold text-[#17312d]">Your summary</h1></div>
        </header>

        {loading ? <div className="rounded-[26px] bg-white/80 p-8 text-center text-sm text-slate-500">Preparing your visit history...</div> : error ? <div className="rounded-[26px] bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div> : data ? <>
          <section className="rounded-[30px] bg-[#143b34] p-5 text-white">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-white/60"><Sparkles className="h-4 w-4" /> Health overview</div>
            <p className="mt-3 text-lg font-bold leading-7">{data.overview.summary}</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/10 p-3"><p className="text-2xl font-black">{data.overview.total_visits}</p><p className="text-xs text-white/65">Clinic visits</p></div>
              <div className="rounded-2xl bg-white/10 p-3"><p className="text-2xl font-black">{data.overview.clinics_visited}</p><p className="text-xs text-white/65">Clinics visited</p></div>
              <div className="rounded-2xl bg-white/10 p-3"><p className="text-2xl font-black">{data.overview.approved_ehr_count || 0}</p><p className="text-xs text-white/65">Approved summaries</p></div>
            </div>
          </section>

          {data.ehr_summaries?.length ? <section className="rounded-[26px] border border-[#b9ddcf] bg-[#f4fbf8] p-5">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-[#1a5c4a]" /><h2 className="font-bold text-slate-950">Doctor-approved summaries</h2></div>
            <p className="mt-1 text-xs leading-5 text-[#60766f]">Simple instructions from your approved clinic records. Follow the prescription shared by your doctor.</p>
            <div className="mt-4 space-y-3">{data.ehr_summaries.map((record) => {
              const summary = record.summary || {};
              const groups = [
                ["Medicines", summary.medicines || []],
                ["Tests", summary.tests || []],
                ["Other instructions", summary.instructions || []],
                ["When to seek help", summary.warning_signs || []],
              ] as const;
              return <article key={record.encounter_id} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-bold text-[#202825]">{record.clinic_name}</p><p className="mt-0.5 text-xs text-[#77756f]">Approved {record.approved_at ? new Date(record.approved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "by your doctor"}</p></div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">Doctor approved</span>
                </div>
                {summary.visit_overview ? <p className="mt-3 text-sm font-semibold leading-6 text-[#30443e]">{summary.visit_overview}</p> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-amber-50 p-3 text-amber-900">
                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><Apple className="h-4 w-4" />Diet & hydration</p>
                    {summary.diet_advice?.length ? <ul className="mt-2 space-y-1 text-sm leading-5">{summary.diet_advice.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs text-amber-800/65">No specific diet advice was recorded.</p>}
                  </div>
                  <div className="rounded-xl bg-[#edf8f3] p-3 text-[#1a5c4a]">
                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><ListChecks className="h-4 w-4" />Doctor suggestions</p>
                    {summary.doctor_suggestions?.length ? <ul className="mt-2 space-y-1 text-sm leading-5">{summary.doctor_suggestions.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs text-[#1a5c4a]/65">No additional suggestions were recorded.</p>}
                  </div>
                </div>
                <div className="mt-3 space-y-3">{groups.filter(([, items]) => items.length).map(([label, items]) => <div key={label}><p className="text-xs font-black uppercase tracking-wide text-[#1a5c4a]">{label}</p><ul className="mt-1 space-y-1 text-sm leading-5 text-[#40514b]">{items.map((item) => <li key={item}>• {item}</li>)}</ul></div>)}</div>
                {summary.follow_up ? <div className="mt-3 rounded-xl bg-[#edf8f3] p-3"><p className="text-xs font-black uppercase tracking-wide text-[#1a5c4a]">Follow-up</p><p className="mt-1 text-sm text-[#30443e]">{summary.follow_up}</p></div> : null}
              </article>;
            })}</div>
          </section> : null}

          <section className="rounded-[26px] border border-white/70 bg-white/80 p-5">
            <div className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-[#1a5c4a]" /><h2 className="font-bold text-slate-950">All clinic visits</h2></div>
            {data.visits.length ? <div className="mt-4 space-y-3">{data.visits.map((visit) => {
              const isOpen = openVisit === visit.id;
              return <article key={visit.id} className="overflow-hidden rounded-2xl bg-[#f6f1e8]">
                <button type="button" onClick={() => setOpenVisit(isOpen ? null : visit.id)} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-[#1a5c4a]"><Stethoscope className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-bold text-[#202825]">{visit.clinic_name}</span><span className="mt-1 flex items-center gap-1 text-xs text-[#77756f]"><CalendarDays className="h-3.5 w-3.5" />{visitDate(visit.date)}{visit.doctor_name ? ` · ${visit.doctor_name}` : ""}</span></span>
                  <ChevronDown className={`h-5 w-5 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen ? <div className="border-t border-[#e6ded3] px-4 pb-4 pt-3">
                  {visit.summary ? <p className="text-sm leading-6 text-[#40514b]">{visit.summary}</p> : <p className="text-sm leading-6 text-[#77756f]">The visit is recorded. A clinical summary will appear after the doctor creates and approves it.</p>}
                  {visit.diagnosis ? <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[#1a5c4a]">Diagnosis recorded</p> : null}
                </div> : null}
              </article>;
            })}</div> : <div className="mt-4 rounded-2xl bg-[#f6f1e8] p-5 text-center"><Building2 className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-sm text-slate-500">No completed clinic visits yet.</p></div>}
          </section>
        </> : null}
      </main>
    </div>
  );
}
