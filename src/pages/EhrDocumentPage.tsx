import { isValidElement, useEffect, useState, useMemo, useRef, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download, Loader2, ShieldCheck, Stethoscope, AlertTriangle } from "lucide-react";
import { apiUrl, clinicAuthHeaders } from "@/lib/api";
import { medicationMealCode, medicationWhenToTake } from "@/lib/medicationDisplay";
import { EMPTY_ASSESSMENT_MESSAGE, EMPTY_PLAN_MESSAGE, hasAssessmentContent as assessmentHasContent, hasPlanContent as planHasContent } from "@/lib/soapPresentation";

interface EhrEncounter {
  encounter_id: string;
  status: string;
  doctor_id?: string | null;
  ehr_data: Record<string, unknown>;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  doctor?: {
    doctor_id?: string | null;
    name?: string | null;
    specialization?: string | null;
    qualifications?: string | null;
  };
  visit?: {
    appointment_id?: number | null;
    appointment_token?: string | null;
    date?: string | null;
    time?: string | null;
  };
}

interface PatientEhrData {
  clinic?: {
    clinic_id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  patient: {
    patient_id: string;
    name: string;
    phone: string;
    email?: string | null;
    blood_group?: string | null;
  };
  encounters: EhrEncounter[];
}

function isSoapFormat(data: Record<string, unknown>): boolean {
  const sv = data.schema_version;
  return !!(sv === "1.0" || sv === "1.1" || data.subjective || data.visit_details);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  // A rendered React node is already display-ready. Never recursively walk
  // its internal element/fiber object as though it were clinical JSON.
  if (isValidElement(value)) return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("value" in obj) return obj.value != null && String(obj.value).trim() !== "";
    if ("systolic" in obj || "diastolic" in obj) return obj.systolic != null || obj.diastolic != null;
    return Object.values(obj).some(hasValue);
  }
  return String(value).trim().length > 0;
}

function hasObjectContent(value: unknown, ...keys: string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return keys.length === 0
    ? Object.values(obj).some((v) => hasValue(v) && v !== false)
    : keys.some((k) => {
        const v = obj[k];
        if (typeof v === "boolean") return v === true;
        return hasValue(v);
      });
}

function isImportantField(field: string): boolean {
  const important = [
    "chief_complaints", "history_of_present_illness",
    "clinical_impression", "diagnoses", "medications",
    "follow_up", "allergies", "current_medications",
    "vitals", "advice", "warning_signs", "referral",
  ];
  return important.includes(field);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return "";
  try {
    const d = new Date(dt);
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch { return dt; }
}

const fieldLabel = (key: string) => key
  .replace(/_/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase())
  .replace("Spo2", "SpO2")
  .replace("Bmi", "BMI");

const PAGE_CSS = `
  @page { size: A4 portrait; margin: 14mm 14mm 16mm 14mm; }
  @media print {
    body { margin: 0 !important; background: #fff !important; }
    .ehr-action-bar, .no-print { display: none !important; }
    .ehr-page-wrapper { max-width: none !important; padding: 0 !important; margin: 0 !important; background: #fff !important; }
    .ehr-document { overflow: visible !important; max-width: none !important; box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; }
    .ehr-print-page-2-start, .ehr-print-page-3-start { break-before: page !important; page-break-before: always !important; }
    [data-ehr-header], [data-ehr-section] > div:first-child, table, tr { break-inside: avoid; page-break-inside: avoid; }
    [data-ehr-section] { margin-top: 0 !important; }
    .print-only { display: block !important; }
  }
  .print-only { display: none; }
`;

function renderClinicalValue(value: unknown, depth = 0): ReactNode {
  if (!hasValue(value)) return null;
  if (isValidElement(value)) return value;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number" || typeof value === "string") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    const items = value.filter(hasValue);
    if (items.length === 0) return null;
    return (
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1a5c4a]" />
            <span>{renderClinicalValue(item, depth + 1)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, v]) => hasValue(v));
    if (entries.length === 0) return null;

    const hasValueUnitSource = "value" in obj && ("unit" in obj || "source" in obj);
    if (hasValueUnitSource) {
      const parts: string[] = [];
      if (hasValue(obj.value)) parts.push(String(obj.value));
      if (hasValue(obj.unit)) parts.push(String(obj.unit));
      const valStr = parts.join(" ");
      const src = hasValue(obj.source) ? String(obj.source) : "";
      return (
        <span>
          <strong>{valStr}</strong>
          {src ? <span className="ml-1 text-xs text-slate-500">({src})</span> : null}
        </span>
      );
    }

    const hasSystolic = "systolic" in obj || "diastolic" in obj;
    if (hasSystolic) {
      const sys = hasValue(obj.systolic) ? String(obj.systolic) : "-";
      const dia = hasValue(obj.diastolic) ? String(obj.diastolic) : "-";
      return <span className="font-semibold">{sys}/{dia}</span>;
    }

    return (
      <div className={depth > 0 ? "ml-2 space-y-0.5" : "space-y-1"}>
        {entries.map(([k, v]) => {
          const label = fieldLabel(k);
          const rendered = renderClinicalValue(v, depth + 1);
          if (!rendered) return null;
          return (
            <div key={k}>
              {depth < 2 ? (
                <div><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><div className="mt-0.5">{rendered}</div></div>
              ) : (
                <div className="text-sm"><strong>{label}:</strong> {rendered}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

function renderField(label: string, value: unknown): ReactNode {
  if (!hasValue(value)) {
    if (isImportantField(label)) {
      return (
        <div className="border-b border-slate-200 pb-3">
          <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(label)}</dt>
          <dd className="mt-1.5 text-sm italic text-slate-400">No {label.toLowerCase().replace(/_/g, " ")} recorded</dd>
        </div>
      );
    }
    return null;
  }
  const rendered = renderClinicalValue(value);
  if (!rendered) {
    if (isImportantField(label)) {
      return (
        <div className="border-b border-slate-200 pb-3">
          <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(label)}</dt>
          <dd className="mt-1.5 text-sm italic text-slate-400">No {label.toLowerCase().replace(/_/g, " ")} recorded</dd>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="border-b border-slate-200 pb-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(label)}</dt>
      <dd className="mt-1.5 text-sm leading-6 text-slate-800">{rendered}</dd>
    </div>
  );
}

function renderFieldWide(label: string, value: unknown): ReactNode {
  const node = renderField(label, value);
  if (!node) return null;
  return <div className="sm:col-span-2">{node}</div>;
}

function renderVitalsGrid(vitals: unknown): ReactNode {
  if (!hasValue(vitals)) return null;
  if (typeof vitals === "object" && !Array.isArray(vitals)) {
    const obj = vitals as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, v]) => hasValue(v));
    if (entries.length === 0) return null;
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {entries.map(([key, val]) => {
          const label = fieldLabel(key);
          let displayValue = "";
          let source = "";
          if (typeof val === "object" && val !== null) {
            const v = val as Record<string, unknown>;
            if ("value" in v && "unit" in v) {
              const raw = v.value;
              displayValue = raw != null ? `${String(raw)}${v.unit ? " " + String(v.unit) : ""}` : "";
            } else if ("systolic" in v || "diastolic" in v) {
              const sys = hasValue(v.systolic) ? String(v.systolic) : "";
              const dia = hasValue(v.diastolic) ? String(v.diastolic) : "";
              displayValue = sys || dia ? `${sys}/${dia}` : "";
            } else if ("value" in v) {
              const raw = v.value;
              displayValue = raw != null ? String(raw) : "";
            } else {
              displayValue = Object.values(v).filter(hasValue).join(", ");
            }
            if (hasValue(v.source)) source = String(v.source);
          } else {
            displayValue = String(val);
          }
          if (!displayValue) return null;
          return (
            <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#58716a]">{label}</div>
              <div className="mt-0.5 text-base font-bold text-slate-800">{displayValue}</div>
              {source ? <div className="mt-0.5 text-[10px] text-slate-500">Source: {source}</div> : null}
            </div>
          );
        })}
      </div>
    );
  }
  return renderClinicalValue(vitals);
}

function renderChiefComplaintsTable(complaints: unknown): ReactNode {
  if (!hasValue(complaints)) return null;
  if (Array.isArray(complaints)) {
    const items = complaints.filter(hasValue);
    if (items.length === 0) return null;
    const isSimple = items.every((i) => typeof i === "string" || typeof i === "number");
    if (isSimple) return renderClinicalValue(complaints);
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="w-2/3 px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Complaint</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Duration</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>;
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{String(o.complaint || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.duration || "\u2014")}</td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td colSpan={2} className="px-3 py-2">{String(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return renderClinicalValue(complaints);
}

function renderCurrentMedicationsTable(medications: unknown): ReactNode {
  if (!hasValue(medications)) return null;
  if (Array.isArray(medications)) {
    const items = medications.filter(hasValue);
    if (items.length === 0) return null;
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Medicine</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>;
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{String(o.name || "")}</td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-2 italic text-slate-400">{String(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return renderClinicalValue(medications);
}

function renderDiagnosesTable(diagnoses: unknown): ReactNode {
  if (!hasValue(diagnoses)) return null;
  if (Array.isArray(diagnoses)) {
    const items = diagnoses.filter(hasValue);
    if (items.length === 0) return null;
    const isSimple = items.every((i) => typeof i === "string" || typeof i === "number");
    if (isSimple) return renderClinicalValue(diagnoses);
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Diagnosis</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Status</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Code</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>;
                const status = String(o.status || "");
                const statusBadge = status === "confirmed" ? "bg-emerald-100 text-emerald-800" :
                                   status === "provisional" ? "bg-amber-100 text-amber-800" :
                                   status === "differential" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-800";
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{String(o.name || "")}</td>
                    <td className="px-3 py-2">
                      {status ? <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusBadge}`}>{status}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-slate-600 font-mono text-[10px]">{String(o.code || "")}</td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td colSpan={3} className="px-3 py-2">{String(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return renderClinicalValue(diagnoses);
}

function renderPlanMedicationsTable(medications: unknown): ReactNode {
  if (!hasValue(medications)) return null;
  if (Array.isArray(medications)) {
    const items = medications.filter(hasValue);
    if (items.length === 0) return null;
    return <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[680px] border-collapse text-xs"><thead><tr className="bg-[#edf7f3] text-[#365c51]"><th className="px-3 py-2 text-left font-black">Medicine</th><th className="px-3 py-2 text-left font-black">Dosage</th><th className="px-3 py-2 text-left font-black">When to take</th><th className="px-3 py-2 text-left font-black">AF / BF</th><th className="px-3 py-2 text-left font-black">Duration</th></tr></thead><tbody>{items.map((item, i) => { if (!item || typeof item !== "object") return <tr key={i}><td colSpan={5} className="px-3 py-2">{String(item)}</td></tr>; const rx = item as Record<string, unknown>; const when = medicationWhenToTake(rx); const meal = medicationMealCode(rx); return <tr key={i} className="border-t border-slate-200"><td className="px-3 py-2 font-bold">{String(rx.medicine_name || rx.name || "Medicine")}</td><td className="px-3 py-2">{String(rx.dose || "—")}</td><td className="px-3 py-2">{when || "—"}</td><td className="px-3 py-2 font-bold">{meal || "—"}</td><td className="px-3 py-2">{String(rx.duration || "—")}</td></tr>; })}</tbody></table></div>;
  }
  return renderClinicalValue(medications);
}

function EhrSection({ title, code, children, className = "" }: { title: string; code?: string; children: ReactNode; className?: string }) {
  return (
    <section data-ehr-section className={`border-t-2 border-[#17312d] pt-3 ${className}`}>
      <div className="mb-4 flex items-center gap-2">
        {code ? <span className="grid h-7 w-7 place-items-center rounded-md bg-[#17312d] text-xs font-black text-white">{code}</span> : null}
        <h3 className="text-sm font-black uppercase tracking-[0.13em] text-[#17312d]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function ClinicalSnapshot({ encounter, patient }: { encounter: EhrEncounter; patient: PatientEhrData["patient"] }) {
  const ehr = encounter.ehr_data;
  const subjective = asRecord(ehr.subjective);
  const objective = asRecord(ehr.objective);
  const assessment = asRecord(ehr.assessment);
  const plan = asRecord(ehr.plan);
  const isSoap = isSoapFormat(ehr);

  if (!isSoap) return null;

  const items: { label: string; value: unknown }[] = [];
  if (hasValue(subjective.chief_complaints)) items.push({ label: "Chief complaint", value: subjective.chief_complaints });
  if (hasValue(subjective.history_of_present_illness)) items.push({ label: "HPI", value: subjective.history_of_present_illness });
  if (hasValue(objective.vitals)) items.push({ label: "Vitals", value: objective.vitals });
  if (hasValue(subjective.allergies)) items.push({ label: "Allergies", value: subjective.allergies });
  if (hasValue(subjective.current_medications)) items.push({ label: "Current medications", value: subjective.current_medications });
  if (hasValue(subjective.family_history)) items.push({ label: "Family history", value: subjective.family_history });
  if (hasValue(subjective.social_history)) items.push({ label: "Social history", value: subjective.social_history });
  if (hasValue(assessment.clinical_impression)) items.push({ label: "Impression", value: assessment.clinical_impression });
  if (hasValue(assessment.confirmed_diagnosis) || hasValue(assessment.provisional_diagnosis)) items.push({ label: "Diagnosis", value: assessment.confirmed_diagnosis || assessment.provisional_diagnosis });
  if (hasValue(plan.follow_up)) items.push({ label: "Follow-up", value: plan.follow_up });

  if (items.length === 0) return null;

  return (
    <section className="rounded-lg border border-[#b9ddcf] bg-[#f4fbf8] p-4">
      <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.13em] text-[#1a5c4a]">Clinical Snapshot</h2>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#58716a]">{item.label}</span>
            <div className="mt-0.5 text-sm font-medium text-slate-800 leading-snug">
              {renderClinicalValue(item.value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const EhrDocumentPage = () => {
  const { patientId, encounterId } = useParams<{ patientId: string; encounterId: string }>();
  const navigate = useNavigate();
  const docRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<PatientEhrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState("");

  const clinicId = (() => {
    try { return localStorage.getItem("clinic_id"); } catch { return null; }
  })();

  useEffect(() => {
    if (!clinicId) {
      setError("Clinic information not available. Please log in again.");
      setLoading(false);
      return;
    }
    if (!patientId) {
      setError("Patient information not available.");
      setLoading(false);
      return;
    }

    fetch(
      apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(patientId)}`),
      { headers: clinicAuthHeaders() },
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load EHR data");
        return res.json();
      })
      .then((payload: PatientEhrData) => {
        setData(payload);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load EHR data");
        setLoading(false);
      });
  }, [clinicId, patientId]);

  const encounter = useMemo(() => {
    if (!data || !encounterId) return null;
    return data.encounters.find((e) => e.encounter_id === encounterId) || null;
  }, [data, encounterId]);

  const isSoap = useMemo(() => {
    if (!encounter) return false;
    return isSoapFormat(encounter.ehr_data);
  }, [encounter]);

  const goBack = () => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("return");
    navigate(returnTo || "/clinic/look");
  };

  const printEhr = () => {
    if (!clinicId || !patientId || !encounterId) {
      setPdfError("Missing information for printing.");
      return;
    }
    window.print();
  };

  const downloadPdf = async () => {
    if (!clinicId || !patientId || !encounterId) {
      setPdfError("Missing information for PDF download.");
      return;
    }
    setPdfDownloading(true);
    setPdfError("");
    try {
      const response = await fetch(
        apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(patientId)}/encounters/${encodeURIComponent(encounterId)}/pdf`),
        { headers: clinicAuthHeaders() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not generate the EHR PDF.");
      }
      const pdf = await response.blob();
      const objectUrl = URL.createObjectURL(pdf);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `ehr-${patientId}-${encounterId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "Could not download the EHR PDF.");
    } finally {
      setPdfDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1a5c4a]" />
          <p className="mt-3 text-sm text-slate-600">Loading EHR record...</p>
        </div>
      </div>
    );
  }

  if (error || !encounter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7f6]">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />
          <p className="mt-3 text-base font-semibold text-red-700">{error || "EHR record not found"}</p>
          <p className="mt-1 text-sm text-slate-500">The requested EHR could not be loaded.</p>
          <Button onClick={goBack} variant="outline" className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Patient Visits
          </Button>
        </div>
      </div>
    );
  }

  const clinic = data!.clinic;
  const patient = data!.patient;
  const ehr = encounter.ehr_data;
  const doctor = encounter.doctor || {};
  const subjective = asRecord(ehr.subjective);
  const objective = asRecord(ehr.objective);
  const assessment = asRecord(ehr.assessment);
  const plan = asRecord(ehr.plan);
  const approval = asRecord(ehr.approval);
  const isApproved = encounter.status === "approved";
  const visitDate = encounter.visit?.date || "";
  const visitTime = encounter.visit?.time || "";
  const token = encounter.visit?.appointment_token || "";
  const approvedDate = encounter.approved_at ? formatDateTime(encounter.approved_at) : null;
  const doctorName = doctor.name
    ? `Dr. ${doctor.name.replace(/^Dr\.?\s*/i, "")}`
    : "Doctor not recorded";
  const version = approval.version ? `Version ${String(approval.version)}` : "Version 1";

  const hasSubjectiveContent = isSoap && (
    hasValue(subjective.chief_complaints) ||
    hasValue(subjective.history_of_present_illness) ||
    hasValue(subjective.relevant_negatives) ||
    hasValue(subjective.medical_conditions) ||
    hasValue(subjective.allergies) ||
    hasValue(subjective.current_medications) ||
    hasValue(subjective.family_history) ||
    hasValue(subjective.social_history)
  );

  const hasObjectiveContent = isSoap && (
    hasValue(objective.vitals) ||
    hasObjectContent(objective.physical_examination, "general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological", "other") ||
    hasValue(objective.investigations)
  );

  const hasAssessmentContent = isSoap && assessmentHasContent(assessment);

  const hasPlanContent = isSoap && planHasContent(plan);

  const legacyEntries = Object.entries(ehr).filter(
    ([key]) => !["schema_version", "visit_details", "approval", "subjective", "objective", "assessment", "plan", "additional_clinical_information", "private_doctor_notes"].includes(key)
  );

  return (
    <div className="min-h-screen bg-[#e8ecea]">
      <style>{PAGE_CSS}</style>

      <div className="ehr-action-bar sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-2.5">
          <Button onClick={goBack} variant="ghost" size="sm" className="shrink-0 text-slate-700 hover:bg-slate-100">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Patient Visits
          </Button>
          <div className="flex items-center gap-1.5">
            <Button onClick={printEhr} variant="outline" size="sm" className="border-[#a9cfc0] bg-white text-[#1a5c4a]">
              <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
            </Button>
            <Button onClick={downloadPdf} disabled={pdfDownloading} size="sm" className="bg-[#1a5c4a] text-white hover:bg-[#15493c]">
              {pdfDownloading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              {pdfDownloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
        </div>
        {pdfError ? (
          <div className="mx-auto max-w-4xl px-4 pb-2">
            <p role="alert" className="text-sm font-semibold text-red-600">{pdfError}</p>
          </div>
        ) : null}
      </div>

      <div className="ehr-page-wrapper mx-auto max-w-4xl px-4 py-6 sm:py-8">
        <div ref={docRef} className="ehr-document mx-auto overflow-hidden rounded-sm border border-slate-300 bg-white text-slate-900 shadow-lg">
          <header data-ehr-header className="border-b-4 border-[#1a5c4a] bg-[#17312d] px-5 py-5 text-white sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-6 w-6 text-[#9de1ca]" />
                  <h2 className="text-xl font-black tracking-tight">{clinic?.name || "Clinic"}</h2>
                </div>
                <p className="mt-1 text-xs text-white/70">{clinic?.address || ""}</p>
                <p className="mt-1 text-xs text-white/70">{[clinic?.phone, clinic?.email].filter(Boolean).join(" \u00b7 ")}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#9de1ca]">Electronic Health Record</p>
                <p className="mt-1 font-mono text-xs text-white/75">{encounter.encounter_id}</p>
                <p className="mt-1 text-[10px] text-white/50">{version}</p>
                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                  isApproved ? "bg-emerald-300 text-emerald-950" : "bg-amber-300 text-amber-950"
                }`}>
                  {isApproved ? "APPROVED" : "DRAFT \u2014 AWAITING DOCTOR APPROVAL"}
                </span>
              </div>
            </div>
          </header>

          <div className="space-y-6 px-5 py-5 sm:px-8">
            <section className="grid gap-0 overflow-hidden rounded-lg border border-slate-300 sm:grid-cols-2">
              <div className="border-b border-slate-300 bg-slate-50 p-4 sm:border-b-0 sm:border-r">
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Patient information</p>
                <p className="mt-2 text-lg font-black">{patient.name}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><dt className="text-slate-500">Patient ID</dt><dd className="font-bold">{patient.patient_id}</dd></div>
                  {patient.blood_group ? <div><dt className="text-slate-500">Blood group</dt><dd className="font-bold">{patient.blood_group}</dd></div> : null}
                  <div><dt className="text-slate-500">Phone</dt><dd className="font-bold">{patient.phone || "\u2014"}</dd></div>
                  {patient.email ? <div><dt className="text-slate-500">Email</dt><dd className="break-all font-bold">{patient.email}</dd></div> : null}
                </dl>
              </div>
              <div className="p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Visit and clinician</p>
                <p className="mt-2 text-base font-black">{doctorName}</p>
                {doctor.specialization ? <p className="text-xs text-slate-600">{doctor.specialization}</p> : null}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><dt className="text-slate-500">Clinic</dt><dd className="font-bold">{clinic?.name || "\u2014"}</dd></div>
                  <div><dt className="text-slate-500">Visit date</dt><dd className="font-bold">{visitDate ? formatDate(visitDate) : "\u2014"}</dd></div>
                  {visitTime ? <div><dt className="text-slate-500">Visit time</dt><dd className="font-bold">{visitTime}</dd></div> : null}
                  {token ? <div><dt className="text-slate-500">Token</dt><dd className="font-bold">{token}</dd></div> : null}
                </dl>
              </div>
            </section>

            <ClinicalSnapshot encounter={encounter} patient={patient} />

            {isSoap ? (
              <>
                {hasSubjectiveContent ? (
                  <EhrSection code="S" title="Subjective \u2014 Patient history" className="ehr-print-page-2-start">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {(() => {
                        const node = renderChiefComplaintsTable(subjective.chief_complaints);
                        if (!node) return isImportantField("chief_complaints") ? (
                          <div className="border-b border-slate-200 pb-3 sm:col-span-2">
                            <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Chief Complaints</dt>
                            <dd className="mt-1.5 text-sm italic text-slate-400">No chief complaints recorded</dd>
                          </div>
                        ) : null;
                        return (
                          <div className="border-b border-slate-200 pb-3 sm:col-span-2">
                            <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Chief Complaints</dt>
                            <dd className="mt-1.5">{node}</dd>
                          </div>
                        );
                      })()}
                      {renderField("History of present illness", subjective.history_of_present_illness)}
                      {renderField("Relevant negatives", subjective.relevant_negatives)}
                      {renderField("Medical conditions", subjective.medical_conditions)}
                      {renderField("Allergies", subjective.allergies)}
                      {renderField("Family history", subjective.family_history)}
                      {renderField("Social history", subjective.social_history)}
                      {(() => {
                        const node = renderCurrentMedicationsTable(subjective.current_medications);
                        if (!node) return isImportantField("current_medications") ? (
                          <div className="border-b border-slate-200 pb-3 sm:col-span-2">
                            <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Current Medications</dt>
                            <dd className="mt-1.5 text-sm italic text-slate-400">No current medications recorded</dd>
                          </div>
                        ) : null;
                        return (
                          <div className="border-b border-slate-200 pb-3 sm:col-span-2">
                            <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Current Medications</dt>
                            <dd className="mt-1.5">{node}</dd>
                          </div>
                        );
                      })()}
                    </dl>
                  </EhrSection>
                ) : null}

                {hasObjectiveContent ? (
                  <EhrSection code="O" title="Objective \u2014 Clinical findings">
                    <dl className="space-y-3">
                      {hasValue(objective.vitals) ? (
                        <div className="border-b border-slate-200 pb-3">
                          <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Vitals and measurements</dt>
                          <dd className="mt-1.5">{renderVitalsGrid(objective.vitals)}</dd>
                        </div>
                      ) : null}
                      {hasObjectContent(objective.physical_examination, "general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological", "other") ? (
                        <div className="border-b border-slate-200 pb-3">
                          <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Physical Examination</dt>
                          <dd className="mt-1.5">{renderClinicalValue(objective.physical_examination)}</dd>
                        </div>
                      ) : null}
                      {renderField("Investigations", objective.investigations)}
                    </dl>
                  </EhrSection>
                ) : null}

                <EhrSection code="A" title="Assessment \u2014 Clinical opinion" className="ehr-print-page-3-start">
                  {hasAssessmentContent ? (
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {renderField("Clinical impression", assessment.clinical_impression)}
                      {renderField("Provisional diagnosis", assessment.provisional_diagnosis)}
                      {renderField("Confirmed diagnosis", assessment.confirmed_diagnosis)}
                      {renderField("Differential diagnoses", assessment.differential_diagnoses)}
                      {renderFieldWide("Problems being managed", assessment.problems_being_managed)}
                    </dl>
                  ) : (
                    <p className="text-sm italic text-slate-500">{EMPTY_ASSESSMENT_MESSAGE}</p>
                  )}
                </EhrSection>

                <EhrSection code="P" title="Plan \u2014 Treatment and follow-up">
                  {hasPlanContent ? (
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        {(() => {
                          const p = renderPlanMedicationsTable(plan.prescriptions);
                          return p ? (
                            <div className="border-b border-slate-200 pb-3">
                              <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Prescriptions</dt>
                              <dd className="mt-1.5">{p}</dd>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {renderField("Tests ordered", plan.tests_ordered)}
                      {renderField("Procedures", plan.procedures)}
                      {renderField("Treatment advice", plan.treatment_advice)}
                      {renderField("Diet & lifestyle advice", plan.diet_lifestyle_advice)}
                      {renderField("Monitoring", plan.monitoring)}
                      {renderField("Referrals", plan.referrals)}
                      {renderField("Follow-up", plan.follow_up)}
                      {renderField("Warning signs", plan.warning_signs)}
                      {renderFieldWide("Other instructions", plan.other_instructions)}
                    </dl>
                  ) : (
                    <p className="text-sm italic text-slate-500">{EMPTY_PLAN_MESSAGE}</p>
                  )}
                </EhrSection>

                {hasValue(ehr.additional_clinical_information) ? (
                  <EhrSection title="Additional clinical information">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {renderFieldWide("Additional information", ehr.additional_clinical_information)}
                    </dl>
                  </EhrSection>
                ) : null}

                {hasValue(ehr.private_doctor_notes) ? (
                  <section className="border-t-2 border-red-700 pt-3">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-700" />
                      <h3 className="text-sm font-black uppercase tracking-[0.13em] text-red-700">Private clinic notes \u2014 Not visible to patient</h3>
                    </div>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <div className="text-sm leading-6 text-slate-800">{renderClinicalValue(ehr.private_doctor_notes)}</div>
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <EhrSection title="Complete clinical record">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {legacyEntries.map(([key, value]) => (
                    <div key={key} className={typeof value === "object" && value !== null && !Array.isArray(value) ? "sm:col-span-2" : ""}>
                      {renderField(key, value)}
                    </div>
                  ))}
                </dl>
              </EhrSection>
            )}

            <footer className="rounded-lg border border-[#b9ddcf] bg-[#f4fbf8] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#1a5c4a]">
                    <ShieldCheck className="h-4 w-4" /> Clinical approval
                  </p>
                  {isApproved ? (
                    <>
                      <p className="mt-1 text-sm font-bold">Approved by {doctorName}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{approvedDate ? `Approved on ${approvedDate}` : ""} \u00b7 {version}</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-sm font-bold text-amber-700">DRAFT \u2014 Awaiting doctor review and approval</p>
                      <p className="mt-0.5 text-xs text-slate-600">This is not a signed final medical record \u00b7 {version}</p>
                    </>
                  )}
                </div>
                <div className="text-left text-[10px] text-slate-500 sm:text-right">
                  <p>This document is part of the patient\u2019s electronic health record.</p>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EhrDocumentPage;
