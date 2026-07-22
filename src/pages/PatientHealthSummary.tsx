import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarDays, FileText, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

interface MedicineItem {
  medicine_name: string;
  strength?: string | null;
  dose?: string | null;
  duration?: string | null;
}

interface VisitSummary {
  reason_for_visit?: string | null;
  what_the_doctor_assessed?: string | null;
  medicines?: (string | MedicineItem)[];
  tests?: string[];
  diet_and_hydration_advice?: string[];
  doctor_instructions?: string[];
  follow_up?: string | null;
  when_to_seek_help?: string[];
}

interface UnifiedVisit {
  id: number | null;
  encounter_id: string | null;
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

const getPatientId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.patient_id || user.id || "";
  } catch { return ""; }
};

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return dateStr; }
};

export default function PatientHealthSummary() {
  const navigate = useNavigate();
  const patientId = useMemo(getPatientId, []);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const viewSummary = (visit: UnifiedVisit) => {
    if (!visit.encounter_id) return;
    navigate(`/patient/summary/${encodeURIComponent(visit.encounter_id)}`);
  };

  const overview = data?.overview;
  const visits = data?.visits || [];

  return (
    <div className="min-h-screen bg-transparent">
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        {/* Header */}
        <header className="flex items-center gap-3">
          <Link to="/patient" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/80 text-[#17312d]" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Your health</p>
            <h1 className="font-display text-2xl font-bold text-[#17312d]">Patient Summaries</h1>
          </div>
        </header>

        {loading ? (
          <div className="rounded-[26px] bg-white/80 p-8 text-center text-sm text-slate-500">Loading your visit history...</div>
        ) : error ? (
          <div className="rounded-[26px] bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : data && visits.length === 0 ? (
          <div className="rounded-[26px] bg-white/80 p-8 text-center">
            <Stethoscope className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">No completed clinic visits yet.</p>
          </div>
        ) : data ? (
          <>
            {/* Compact Health Overview */}
            {overview ? (
              <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm sm:flex-nowrap sm:gap-4">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#58716a]">Health Overview</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
                  <span><strong className="text-[#1a5c4a]">{overview.total_visits}</strong> {overview.total_visits === 1 ? "visit" : "visits"}</span>
                  <span className="hidden sm:inline text-slate-300">|</span>
                  <span><strong className="text-[#1a5c4a]">{overview.clinics_visited}</strong> {overview.clinics_visited === 1 ? "clinic" : "clinics"}</span>
                  <span className="hidden sm:inline text-slate-300">|</span>
                  <span><strong className="text-[#1a5c4a]">{overview.approved_ehr_count}</strong> {overview.approved_ehr_count === 1 ? "summary" : "summaries"} available</span>
                </div>
              </section>
            ) : null}

            {/* My Clinic Visits */}
            <section>
              <h2 className="flex items-center gap-2 text-base font-bold text-slate-950">
                <CalendarDays className="h-4 w-4 text-[#1a5c4a]" /> My Clinic Visits
              </h2>

              <div className="mt-3 space-y-3">
                {visits.map((visit, idx) => (
                  <article key={visit.encounter_id || `visit-${visit.id || idx}`} className="overflow-hidden rounded-2xl border border-[#e6ded3] bg-white">
                    <div className="p-4">
                      {/* Header row */}
                      <p className="text-xs font-bold uppercase tracking-wide text-[#58716a]">{formatDate(visit.date)}</p>
                      <p className="mt-1 text-base font-bold text-[#202825]">
                        {visit.doctor_name ? `Dr. ${visit.doctor_name.replace(/^Dr\.?\s*/i, "")}` : "Doctor"}
                      </p>
                      <p className="mt-0.5 text-sm text-[#77756f]">
                        {visit.clinic_name}{visit.visit_type ? <span> \u2022 {visit.visit_type === "online" ? "Online consultation" : "In-clinic visit"}</span> : null}
                      </p>

                      {/* Status badge */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {visit.summary_status === "available" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Summary available
                          </span>
                        ) : visit.summary_status === "being_prepared" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Summary being prepared
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">No summary for this visit</span>
                        )}
                      </div>

                      {/* Inline summary preview */}
                      {visit.summary && visit.summary_status === "available" ? (
                        <div className="mt-3 rounded-lg border border-[#d9eae2] bg-[#f4fbf8] p-3 text-sm">
                          {visit.summary.reason_for_visit ? (
                            <p className="text-xs font-semibold text-[#17312d]">
                              <span className="uppercase tracking-wide text-[#58716a]">Reason: </span>
                              {visit.summary.reason_for_visit}
                            </p>
                          ) : null}
                          {visit.summary.what_the_doctor_assessed ? (
                            <p className="mt-1.5 text-xs text-[#40514b]">
                              <span className="font-semibold uppercase tracking-wide text-[#58716a]">Assessment: </span>
                              {visit.summary.what_the_doctor_assessed.length > 120
                                ? visit.summary.what_the_doctor_assessed.slice(0, 120) + "..."
                                : visit.summary.what_the_doctor_assessed}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#40514b]">
                            {visit.summary.medicines?.length ? (
                              <span><span className="font-semibold text-[#58716a]">Medicines:</span> {visit.summary.medicines.slice(0, 3).map((m) => typeof m === "object" ? m.medicine_name : String(m)).join(", ")}{visit.summary.medicines.length > 3 ? ` +${visit.summary.medicines.length - 3} more` : ""}</span>
                            ) : null}
                            {visit.summary.tests?.length ? (
                              <span><span className="font-semibold text-[#58716a]">Tests:</span> {visit.summary.tests.slice(0, 2).join(", ")}{visit.summary.tests.length > 2 ? ` +${visit.summary.tests.length - 2} more` : ""}</span>
                            ) : null}
                            {visit.summary.follow_up ? (
                              <span><span className="font-semibold text-[#58716a]">Follow-up:</span> {visit.summary.follow_up.length > 60 ? visit.summary.follow_up.slice(0, 60) + "..." : visit.summary.follow_up}</span>
                            ) : null}
                          </div>
                          {visit.summary.when_to_seek_help?.length ? (
                            <div className="mt-2 flex items-start gap-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>Warning signs recorded — <button onClick={() => viewSummary(visit)} className="font-bold underline">see full summary</button></span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {/* Action button */}
                      {visit.summary_status === "available" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => viewSummary(visit)}
                          className="mt-3 w-full border-[#a9cfc0] bg-white text-[#1a5c4a] hover:bg-[#edf8f3] sm:w-auto"
                        >
                          <FileText className="mr-1.5 h-3.5 w-3.5" /> View Full Summary
                        </Button>
                      ) : visit.summary_status === "being_prepared" ? (
                        <Button variant="outline" size="sm" disabled className="mt-3 opacity-50 sm:w-auto">
                          <FileText className="mr-1.5 h-3.5 w-3.5" /> View Summary
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
