import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Printer, Download, Loader2, AlertTriangle, Stethoscope, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";

interface MedicineItem {
  medicine_name: string;
  strength?: string | null;
  dose?: string | null;
  schedule?: { morning?: string | null; afternoon?: string | null; night?: string | null } | null;
  meal_timing?: string | null;
  specific_timing?: string | null;
  frequency?: string | null;
  duration?: string | null;
  as_needed?: boolean;
  indication?: string | null;
  additional_instructions?: string | null;
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
  visits: UnifiedVisit[];
}

const getPatientId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.patient_id || user.id || "";
  } catch { return ""; }
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return dateStr; }
};

const formatDateTime = (dt: string) => {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch { return dt; }
};

const PRINT_CSS = `
  @media print {
    body { background: #fff !important; }
    .no-print { display: none !important; }
    .print-summary-only { display: block !important; }
    @page { margin: 14mm; }
  }
  .print-summary-only { display: none; }
`;

const PAGE_CSS = `
  @page { size: A4 portrait; margin: 14mm; }
  @media print {
    body { background: #fff !important; }
    .summary-action-bar { display: none !important; }
    .summary-page-wrapper { padding: 0 !important; background: #fff !important; }
    .summary-document { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
  }
`;

function SummaryContent({ summary, approved_at, doctor_name, clinic_name, visit_date, visit_type }: {
  summary: VisitSummary;
  approved_at: string | null;
  doctor_name: string | null;
  clinic_name: string;
  visit_date: string;
  visit_type: string;
}) {
  const items: { label: string; value: unknown; type?: "text" | "list" | "warning" | "medicines" }[] = [];

  if (summary.reason_for_visit) items.push({ label: "Reason for visit", value: summary.reason_for_visit, type: "text" });
  if (summary.what_the_doctor_assessed) items.push({ label: "What the doctor found", value: summary.what_the_doctor_assessed, type: "text" });
  if (summary.medicines?.length) {
    const hasStructured = summary.medicines.some((m) => typeof m === "object");
    items.push({ label: "Medicines", value: summary.medicines, type: hasStructured ? "medicines" : "list" });
  }
  if (summary.tests?.length) items.push({ label: "Tests", value: summary.tests, type: "list" });
  if (summary.diet_and_hydration_advice?.length) items.push({ label: "Diet and hydration advice", value: summary.diet_and_hydration_advice, type: "list" });
  if (summary.doctor_instructions?.length) items.push({ label: "Doctor instructions", value: summary.doctor_instructions, type: "list" });
  if (summary.follow_up) items.push({ label: "Follow-up", value: summary.follow_up, type: "text" });
  if (summary.when_to_seek_help?.length) items.push({ label: "When to seek medical help", value: summary.when_to_seek_help, type: "warning" });

  return (
    <div className="space-y-5">
      {/* Visit info */}
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-4">
        <p className="text-lg font-bold text-[#202825]">{doctor_name ? `Dr. ${doctor_name.replace(/^Dr\.?\s*/i, "")}` : "Doctor"}</p>
        <p className="text-sm text-[#77756f]">{clinic_name}{visit_type ? ` \u2022 ${visit_type === "online" ? "Online consultation" : "In-clinic visit"}` : ""}</p>
        <p className="flex items-center gap-1.5 text-sm text-[#77756f]">
          <CalendarDays className="h-3.5 w-3.5" />{formatDate(visit_date)}
          {approved_at ? <span className="text-[10px] text-slate-400">Approved {formatDateTime(approved_at)}</span> : null}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm italic text-slate-500">No details recorded for this visit.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            if (item.type === "warning") {
              return (
                <div key={item.label} className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> {item.label}
                  </p>
                  {renderListValue(item.value)}
                </div>
              );
            }
            if (item.type === "medicines") {
              return (
                <div key={item.label} className="sm:col-span-2 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#58716a]">{item.label}</p>
                  {renderMedicinesTable(item.value)}
                </div>
              );
            }
            if (item.type === "list") {
              return (
                <div key={item.label} className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#58716a]">{item.label}</p>
                  {renderListValue(item.value)}
                </div>
              );
            }
            return (
              <div key={item.label} className={item.label === "Reason for visit" || item.label === "What the doctor found" || item.label === "Follow-up" ? "sm:col-span-2 min-w-0" : "min-w-0"}>
                <p className="text-xs font-bold uppercase tracking-wide text-[#58716a]">{item.label}</p>
                <p className="mt-0.5 text-sm leading-6 text-slate-800">{String(item.value)}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderListValue(value: unknown) {
  if (Array.isArray(value)) {
    const items = value.filter(Boolean);
    if (items.length === 0) return null;
    return (
      <ul className="mt-0.5 space-y-0.5 text-sm leading-6 text-slate-800">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1a5c4a]" />
            <span>{String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="mt-0.5 text-sm leading-6 text-slate-800">{String(value)}</p>;
}

function renderMedicinesTable(value: unknown) {
  if (!Array.isArray(value)) return null;
  const medicines = value.filter((m): m is MedicineItem => typeof m === "object" && m !== null && "medicine_name" in m);
  if (medicines.length === 0) return renderListValue(value);
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-300 bg-slate-50">
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[#58716a]">Medicine</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[#58716a]">How much</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[#58716a]">When to take</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[#58716a]">How long</th>
            <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[#58716a]">Important instruction</th>
          </tr>
        </thead>
        <tbody>
          {medicines.map((m, i) => {
            const howMuch = [m.strength, m.dose].filter(Boolean).join(" ");
            const whenParts: string[] = [];
            if (m.schedule) {
              if (m.schedule.morning) whenParts.push(`Morning: ${m.schedule.morning}`);
              if (m.schedule.afternoon) whenParts.push(`Afternoon: ${m.schedule.afternoon}`);
              if (m.schedule.night) whenParts.push(`Night: ${m.schedule.night}`);
            }
            if (m.meal_timing) whenParts.push(m.meal_timing);
            if (m.specific_timing) whenParts.push(m.specific_timing);
            if (m.frequency) whenParts.push(m.frequency);
            if (m.as_needed) whenParts.push("As needed (PRN)");
            const when = whenParts.join("; ");
            const howLong = m.duration || "";
            const important = [m.indication, m.additional_instructions].filter(Boolean).join("; ");
            return (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-2 py-1.5 font-medium">{m.medicine_name}</td>
                <td className="px-2 py-1.5 text-slate-600">{howMuch || "\u2014"}</td>
                <td className="px-2 py-1.5 text-slate-600">{when || "\u2014"}</td>
                <td className="px-2 py-1.5 text-slate-600">{howLong || "\u2014"}</td>
                <td className="px-2 py-1.5 text-slate-600">{important || "\u2014"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PatientSummaryDetail = () => {
  const { encounterId } = useParams<{ encounterId: string }>();
  const navigate = useNavigate();
  const patientId = useMemo(getPatientId, []);

  const [visit, setVisit] = useState<UnifiedVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  useEffect(() => {
    if (!patientId) { setError("Please sign in again to view your summary."); setLoading(false); return; }
    if (!encounterId) { setError("Summary not found."); setLoading(false); return; }

    const controller = new AbortController();
    fetch(apiUrl(`/api/patient-health/summary?patient_id=${encodeURIComponent(patientId)}`), { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "Could not load summary");
        return body as SummaryData;
      })
      .then((data) => {
        const found = data.visits.find((v) => v.encounter_id === encounterId);
        if (!found || found.summary_status !== "available" || !found.summary) {
          throw new Error("Summary not available for this visit.");
        }
        setVisit(found);
        setLoading(false);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message || "Could not load summary");
        setLoading(false);
      });
    return () => controller.abort();
  }, [patientId, encounterId]);

  const goBack = () => {
    navigate("/patient/health-summary");
  };

  const printSummary = () => {
    window.print();
  };

  const downloadSummary = () => {
    setPdfDownloading(true);
    const printWindow = window.open("", "_blank");
    if (!printWindow) { setPdfDownloading(false); return; }
    printWindow.document.write(`
      <html><head><title>Patient Summary</title>
      <style>
        body { font-family: Inter, Arial, sans-serif; color: #1a1a1a; padding: 20px; max-width: 700px; margin: 0 auto; line-height: 1.5; }
        h1 { font-size: 16pt; color: #1a5c4a; border-bottom: 2px solid #1a5c4a; padding-bottom: 6px; }
        h2 { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; color: #58716a; margin: 14px 0 3px; }
        p { font-size: 10pt; margin: 3px 0; }
        ul { margin: 3px 0; padding-left: 18px; }
        li { font-size: 10pt; margin: 1px 0; }
        .meta { font-size: 8pt; color: #8a9a93; margin-bottom: 12px; }
        .warning { background: #fef6f5; border-left: 3px solid #c0392b; padding: 6px 10px; margin: 10px 0; }
        .warning h2 { color: #c0392b; }
      </style></head><body>
      <h1>Your Consultation Summary</h1>
      <div class="meta">
        <p>${visit ? (visit.doctor_name ? `Dr. ${visit.doctor_name.replace(/^Dr\.?\s*/i, "")}` : "Doctor") : ""}</p>
        <p>${visit?.clinic_name || ""}${visit?.visit_type ? ` — ${visit.visit_type === "online" ? "Online consultation" : "In-clinic visit"}` : ""}</p>
        <p>${visit?.date ? formatDate(visit.date) : ""}${visit?.approved_at ? ` · Approved ${formatDateTime(visit.approved_at)}` : ""}</p>
      </div>
      ${visit?.summary ? buildPrintHtml(visit.summary) : ""}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); setPdfDownloading(false); }, 500);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1a5c4a]" />
          <p className="mt-3 text-sm text-slate-600">Loading your summary...</p>
        </div>
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />
          <p className="mt-3 text-base font-semibold text-red-700">{error || "Summary not found"}</p>
          <p className="mt-1 text-sm text-slate-500">This summary may no longer be available.</p>
          <Button onClick={goBack} variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Summaries
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8ecea]">
      <style>{PAGE_CSS}</style>
      <style>{PRINT_CSS}</style>

      {/* Sticky Action Bar */}
      <div className="summary-action-bar sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
          <Button onClick={goBack} variant="ghost" size="sm" className="shrink-0 text-slate-700 hover:bg-slate-100">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Summaries
          </Button>
          <div className="flex items-center gap-1.5">
            <Button onClick={printSummary} variant="outline" size="sm" className="border-[#a9cfc0] bg-white text-[#1a5c4a]">
              <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
            </Button>
            <Button onClick={downloadSummary} disabled={pdfDownloading} size="sm" className="bg-[#1a5c4a] text-white hover:bg-[#15493c]">
              {pdfDownloading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              {pdfDownloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
        </div>
      </div>

      {/* Document Container */}
      <div className="summary-page-wrapper mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <div className="summary-document mx-auto overflow-hidden rounded-sm border border-slate-300 bg-white text-slate-900 shadow-lg">
          {/* Header */}
          <header className="border-b-4 border-[#1a5c4a] bg-[#17312d] px-5 py-5 text-white sm:px-8">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-[#9de1ca]" />
              <div>
                <h2 className="text-lg font-black tracking-tight">Your Consultation Summary</h2>
                <p className="mt-0.5 text-[10px] text-white/60">Your clinic visit at a glance</p>
              </div>
            </div>
          </header>

          <div className="px-5 py-5 sm:px-8">
            <SummaryContent
              summary={visit.summary!}
              approved_at={visit.approved_at}
              doctor_name={visit.doctor_name}
              clinic_name={visit.clinic_name}
              visit_date={visit.date}
              visit_type={visit.visit_type}
            />
          </div>

          <footer className="border-t border-slate-200 px-5 py-3 text-center text-[10px] text-slate-400 sm:px-8">
            This is a patient-friendly summary of your clinic visit. It is not a complete medical record.
          </footer>
        </div>
      </div>
    </div>
  );
};

function buildPrintHtml(summary: VisitSummary): string {
  let html = "";
  if (summary.reason_for_visit) html += `<h2>Reason for visit</h2><p>${summary.reason_for_visit}</p>`;
  if (summary.what_the_doctor_assessed) html += `<h2>What the doctor found</h2><p>${summary.what_the_doctor_assessed}</p>`;
  if (summary.medicines?.length) {
    const hasStructured = summary.medicines.some((m) => typeof m === "object");
    if (hasStructured) {
      html += `<h2>Medicines</h2><table style="width:100%;border-collapse:collapse;font-size:10pt;"><thead><tr style="background:#edf3f0;">`;
      html += `<th style="padding:4px 6px;text-align:left;font-weight:700;">Medicine</th>`;
      html += `<th style="padding:4px 6px;text-align:left;font-weight:700;">How much</th>`;
      html += `<th style="padding:4px 6px;text-align:left;font-weight:700;">When to take</th>`;
      html += `<th style="padding:4px 6px;text-align:left;font-weight:700;">How long</th>`;
      html += `<th style="padding:4px 6px;text-align:left;font-weight:700;">Important instruction</th>`;
      html += `</tr></thead><tbody>`;
      for (const m of summary.medicines) {
        if (typeof m === "object" && m !== null) {
          const rx = m as MedicineItem;
          const howMuch = [rx.strength, rx.dose].filter(Boolean).join(" ");
          const whenParts: string[] = [];
          if (rx.schedule) {
            if (rx.schedule.morning) whenParts.push(`Morning: ${rx.schedule.morning}`);
            if (rx.schedule.afternoon) whenParts.push(`Afternoon: ${rx.schedule.afternoon}`);
            if (rx.schedule.night) whenParts.push(`Night: ${rx.schedule.night}`);
          }
          if (rx.meal_timing) whenParts.push(rx.meal_timing);
          if (rx.specific_timing) whenParts.push(rx.specific_timing);
          if (rx.frequency) whenParts.push(rx.frequency);
          if (rx.as_needed) whenParts.push("As needed (PRN)");
          const whenStr = whenParts.join("; ");
          const important = [rx.indication, rx.additional_instructions].filter(Boolean).join("; ");
          html += `<tr style="border-bottom:1px solid #ddd;">`;
          html += `<td style="padding:4px 6px;font-weight:600;">${escapeHtml(rx.medicine_name)}</td>`;
          html += `<td style="padding:4px 6px;">${escapeHtml(howMuch || "\u2014")}</td>`;
          html += `<td style="padding:4px 6px;">${escapeHtml(whenStr || "\u2014")}</td>`;
          html += `<td style="padding:4px 6px;">${escapeHtml(rx.duration || "\u2014")}</td>`;
          html += `<td style="padding:4px 6px;">${escapeHtml(important || "\u2014")}</td>`;
          html += `</tr>`;
        }
      }
      html += `</tbody></table>`;
    } else {
      html += `<h2>Medicines</h2><ul>${summary.medicines.map((m) => `<li>${String(m)}</li>`).join("")}</ul>`;
    }
  }
  if (summary.tests?.length) html += `<h2>Tests</h2><ul>${summary.tests.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  if (summary.diet_and_hydration_advice?.length) html += `<h2>Diet and hydration advice</h2><ul>${summary.diet_and_hydration_advice.map((d) => `<li>${d}</li>`).join("")}</ul>`;
  if (summary.doctor_instructions?.length) html += `<h2>Doctor instructions</h2><ul>${summary.doctor_instructions.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  if (summary.follow_up) html += `<h2>Follow-up</h2><p>${summary.follow_up}</p>`;
  if (summary.when_to_seek_help?.length) {
    html += `<div class="warning"><h2>When to seek medical help</h2><ul>${summary.when_to_seek_help.map((w) => `<li>${w}</li>`).join("")}</ul></div>`;
  }
  return html;
}

export default PatientSummaryDetail;
