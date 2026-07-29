import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

interface MedicineItem {
  medicine_name: string;
  strength?: string | null;
  dose?: string | null;
  duration?: string | null;
}

interface VisitSummary {
  visit_summary?: string | null;
  medicines?: (string | MedicineItem)[];
  tests?: string[];
  procedures?: string[];
  diet_and_care?: string[];
  monitoring?: string[];
  referrals?: string[];
  other_instructions?: string[];
  follow_up?: string | null;
  when_to_seek_help?: unknown[];
}

interface UnifiedVisit {
  id: number | null;
  encounter_id: string | null;
  clinic_id?: string | null;
  clinic_name: string;
  doctor_name: string | null;
  date: string;
  time: string;
  visit_type: string;
  summary_status: string;
  summary: VisitSummary | null;
  approved_at: string | null;
}

interface SummaryData {
  overview: {
    total_visits: number;
    clinics_visited: number;
    approved_ehr_count: number;
  };
  visits: UnifiedVisit[];
}

interface ClinicGroup {
  key: string;
  name: string;
  visits: UnifiedVisit[];
}

const getPatientId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.patient_id || user.id || "";
  } catch {
    return "";
  }
};

const formatDate = (dateStr: string) => {
  try {
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr || "Date not recorded";
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr || "Date not recorded";
  }
};

const formatTime = (time: string) => {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return time || "Time not recorded";
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
};

const visitTimestamp = (visit: UnifiedVisit) => {
  const dateTime = Date.parse(`${visit.date || "1970-01-01"}T${visit.time || "00:00"}`);
  if (!Number.isNaN(dateTime)) return dateTime;
  const approvedDate = Date.parse(visit.approved_at || "");
  return Number.isNaN(approvedDate) ? 0 : approvedDate;
};

function VisitCard({ visit, priority, onView }: { visit: UnifiedVisit; priority: number | null; onView: () => void }) {
  const summaryAvailable = visit.summary_status === "available";
  return (
    <article className={`overflow-hidden rounded-2xl border bg-white ${priority ? "border-[#a9cfc0] shadow-[0_14px_35px_-30px_rgba(26,92,74,0.8)]" : "border-[#e6ded3]"}`}>
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#58716a]">
            <CalendarDays className="h-3.5 w-3.5" /> {formatDate(visit.date)}
          </p>
          {priority ? <span className="rounded-full bg-[#e3f3ec] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#1a5c4a]">Recent visit {priority}</span> : null}
        </div>

        <p className="mt-1 text-base font-bold text-[#202825]">
          {visit.doctor_name ? `Dr. ${visit.doctor_name.replace(/^Dr\.?\s*/i, "")}` : "Doctor"}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#77756f]">
          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatTime(visit.time)}</span>
          {visit.visit_type ? <span>· {visit.visit_type === "online" ? "Online consultation" : "In-clinic visit"}</span> : null}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {summaryAvailable ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Summary available</span>
          ) : visit.summary_status === "being_prepared" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Summary being prepared</span>
          ) : <span className="text-[11px] italic text-slate-500">No summary for this visit</span>}
        </div>

        {visit.summary && summaryAvailable ? (
          <div className="mt-3 rounded-xl border border-[#d9eae2] bg-[#f4fbf8] p-3">
            {visit.summary.visit_summary ? (
              <p className="text-xs leading-5 text-[#40514b]"><span className="font-semibold uppercase tracking-wide text-[#58716a]">Visit summary: </span>{visit.summary.visit_summary.length > 120 ? visit.summary.visit_summary.slice(0, 120) + "..." : visit.summary.visit_summary}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#40514b]">
              {visit.summary.medicines?.length ? <span><span className="font-semibold text-[#58716a]">Medicines:</span> {visit.summary.medicines.slice(0, 3).map((medicine) => typeof medicine === "object" ? medicine.medicine_name : String(medicine)).join(", ")}{visit.summary.medicines.length > 3 ? ` +${visit.summary.medicines.length - 3} more` : ""}</span> : null}
              {visit.summary.tests?.length ? <span><span className="font-semibold text-[#58716a]">Tests:</span> {visit.summary.tests.slice(0, 2).join(", ")}{visit.summary.tests.length > 2 ? ` +${visit.summary.tests.length - 2} more` : ""}</span> : null}
              {visit.summary.follow_up ? <span><span className="font-semibold text-[#58716a]">Follow-up:</span> {visit.summary.follow_up.length > 60 ? visit.summary.follow_up.slice(0, 60) + "..." : visit.summary.follow_up}</span> : null}
            </div>
            {visit.summary.when_to_seek_help?.length ? <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>Warning signs recorded — open the full summary for details.</span></div> : null}
          </div>
        ) : null}

        {summaryAvailable ? (
          <Button variant="outline" size="sm" onClick={onView} className="mt-3 w-full border-[#a9cfc0] bg-white text-[#1a5c4a] hover:bg-[#edf8f3] sm:w-auto"><FileText className="mr-1.5 h-3.5 w-3.5" /> View Full Summary</Button>
        ) : visit.summary_status === "being_prepared" ? (
          <Button variant="outline" size="sm" disabled className="mt-3 opacity-50 sm:w-auto"><FileText className="mr-1.5 h-3.5 w-3.5" /> View Summary</Button>
        ) : null}
      </div>
    </article>
  );
}

export default function PatientHealthSummary() {
  const navigate = useNavigate();
  const patientId = useMemo(getPatientId, []);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedClinics, setExpandedClinics] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!patientId) {
      setError("Please sign in again to view your summary.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(apiUrl(`/api/patient-health/summary?patient_id=${encodeURIComponent(patientId)}`), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "Could not load summary");
        return body;
      })
      .then(setData)
      .catch((reason) => { if (reason.name !== "AbortError") setError(reason.message || "Could not load summary"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [patientId]);

  const visits = data?.visits || [];
  const clinicGroups = useMemo<ClinicGroup[]>(() => {
    const grouped = new Map<string, ClinicGroup>();
    for (const visit of visits) {
      const name = visit.clinic_name?.trim() || "Clinic";
      const key = visit.clinic_id?.trim() || name.toLocaleLowerCase();
      if (!grouped.has(key)) grouped.set(key, { key, name, visits: [] });
      grouped.get(key)!.visits.push(visit);
    }
    return Array.from(grouped.values())
      .map((clinic) => ({ ...clinic, visits: [...clinic.visits].sort((a, b) => visitTimestamp(b) - visitTimestamp(a)) }))
      .sort((a, b) => visitTimestamp(b.visits[0]) - visitTimestamp(a.visits[0]));
  }, [visits]);

  const toggleClinic = (key: string) => {
    setExpandedClinics((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const viewSummary = (visit: UnifiedVisit) => {
    if (visit.encounter_id) navigate(`/patient/summary/${encodeURIComponent(visit.encounter_id)}`);
  };

  return (
    <div className="min-h-screen bg-transparent">
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <header className="flex items-center gap-3">
          <Link to="/patient" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/80 text-[#17312d]" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Your health</p><h1 className="font-display text-2xl font-bold text-[#17312d]">Patient Summaries</h1></div>
        </header>

        {loading ? <div className="rounded-[26px] bg-white/80 p-8 text-center text-sm text-slate-500">Loading your visit history...</div>
          : error ? <div className="rounded-[26px] bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
          : data && visits.length === 0 ? <div className="rounded-[26px] bg-white/80 p-8 text-center"><Stethoscope className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm text-slate-500">No completed clinic visits yet.</p></div>
          : data ? <>
            <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm sm:flex-nowrap sm:gap-4">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#58716a]">Health Overview</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
                <span><strong className="text-[#1a5c4a]">{data.overview.total_visits}</strong> {data.overview.total_visits === 1 ? "visit" : "visits"}</span>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span><strong className="text-[#1a5c4a]">{data.overview.clinics_visited}</strong> {data.overview.clinics_visited === 1 ? "clinic" : "clinics"}</span>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span><strong className="text-[#1a5c4a]">{data.overview.approved_ehr_count}</strong> {data.overview.approved_ehr_count === 1 ? "summary" : "summaries"} available</span>
              </div>
            </section>

            <section>
              <div className="flex items-end justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#58716a]">Visit history</p><h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-950"><Building2 className="h-5 w-5 text-[#1a5c4a]" /> Your clinics</h2></div>
                <span className="text-xs font-semibold text-slate-500">Most recent first</span>
              </div>

              <div className="mt-4 space-y-4">
                {clinicGroups.map((clinic) => {
                  const isExpanded = expandedClinics.has(clinic.key);
                  const available = clinic.visits.filter((visit) => visit.summary_status === "available").length;
                  return <article key={clinic.key} className="overflow-hidden rounded-[24px] border border-[#dbe7e1] bg-white shadow-[0_18px_50px_-42px_rgba(23,49,45,0.75)]">
                    <button type="button" onClick={() => toggleClinic(clinic.key)} aria-expanded={isExpanded} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-[#f7fbf9] sm:p-5">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e8f4ef] text-[#1a5c4a]"><Building2 className="h-5 w-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-base font-bold text-[#17312d]">{clinic.name}</span><span className="mt-1 block text-xs text-slate-500">Last visit {formatDate(clinic.visits[0].date)} · {clinic.visits.length} {clinic.visits.length === 1 ? "visit" : "visits"} · {available} {available === 1 ? "summary" : "summaries"}</span></span>
                      <span className="shrink-0 text-[#58716a]">{isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</span>
                    </button>

                    {isExpanded ? <div className="border-t border-[#e4ece8] bg-[#f8fbf9] p-3 sm:p-4">
                      <div className="mb-3 flex items-center justify-between px-1"><p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#58716a]">All visits · newest first</p><p className="text-[11px] text-slate-500">Latest two prioritized</p></div>
                      <div className="space-y-3">{clinic.visits.map((visit, index) => <VisitCard key={visit.encounter_id || `visit-${visit.id || index}`} visit={visit} priority={index < 2 ? index + 1 : null} onView={() => viewSummary(visit)} />)}</div>
                    </div> : null}
                  </article>;
                })}
              </div>
            </section>
          </> : null}
      </main>
    </div>
  );
}
