import { useEffect, useState, useMemo, useRef, type ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download, Loader2, ShieldCheck, FileText, Stethoscope, AlertTriangle } from "lucide-react";
import { apiUrl } from "@/lib/api";

interface EhrEncounter {
  encounter_id: string;
  status: string;
  doctor_id?: string | null;
  ehr_data: Record<string, unknown>;
  model_name?: string | null;
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
  return !!(data.schema_version || data.subjective || data.visit_details);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasValue);
  }
  return String(value).trim().length > 0;
}

function isImportantField(field: string): boolean {
  const important = [
    "chief_complaints", "history_of_present_illness", "symptoms",
    "clinical_impression", "diagnosis_status", "provisional_diagnoses",
    "confirmed_diagnoses", "prescriptions", "follow_up",
    "allergies", "current_medicines", "vitals",
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
    .print-only { display: block !important; }
  }
  .print-only { display: none; }
`;

function renderClinicalValue(value: unknown, depth = 0): ReactNode {
  if (!hasValue(value)) return null;
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

function renderSymptomsTable(symptoms: unknown): ReactNode {
  if (!hasValue(symptoms)) return null;
  if (Array.isArray(symptoms)) {
    const items = symptoms.filter(hasValue);
    if (items.length === 0) return null;
    const isSimple = items.every((i) => typeof i === "string" || typeof i === "number");
    if (isSimple) {
      return renderClinicalValue(symptoms);
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Symptom</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Duration</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Severity</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Source</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>;
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{String(o.name || o.symptom_name || o.symptom || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.duration || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.severity || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.source || "")}</td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td colSpan={4} className="px-3 py-2">{String(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return renderClinicalValue(symptoms);
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
              displayValue = `${String(v.value)}${v.unit ? " " + String(v.unit) : ""}`;
            } else if ("systolic" in v || "diastolic" in v) {
              const sys = hasValue(v.systolic) ? String(v.systolic) : "-";
              const dia = hasValue(v.diastolic) ? String(v.diastolic) : "-";
              displayValue = `${sys}/${dia}`;
            } else if ("value" in v) {
              displayValue = String(v.value);
            } else {
              displayValue = Object.values(v).filter(hasValue).join(", ");
            }
            if (hasValue(v.source)) source = String(v.source);
          } else {
            displayValue = String(val);
          }
          return (
            <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#58716a]">{label}</div>
              <div className="mt-0.5 text-base font-bold text-slate-800">{displayValue || "\u2014"}</div>
              {source ? <div className="mt-0.5 text-[10px] text-slate-500">Source: {source}</div> : null}
            </div>
          );
        })}
      </div>
    );
  }
  return renderClinicalValue(vitals);
}

function renderPrescriptionsTable(prescriptions: unknown): ReactNode {
  if (!hasValue(prescriptions)) return null;
  if (Array.isArray(prescriptions)) {
    const items = prescriptions.filter(hasValue);
    if (items.length === 0) return null;
    const hasDetails = items.some(
      (i) => typeof i === "object" && i !== null && ("dose" in i || "frequency" in i || "strength" in i || "duration" in i)
    );
    if (!hasDetails) {
      return renderClinicalValue(prescriptions);
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Medicine</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Strength</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Dose</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Morning</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Afternoon</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Night</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Meal</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Timing</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Frequency</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Duration</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">PRN</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Indication</th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Instructions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              if (typeof item === "object" && item !== null) {
                const o = item as Record<string, unknown>;
                const schedule = (o.schedule && typeof o.schedule === "object" && !Array.isArray(o.schedule) ? o.schedule as Record<string, unknown> : {}) as Record<string, unknown>;
                return (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{String(o.medicine_name || o.name || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.strength || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.dose || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(schedule.morning || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(schedule.afternoon || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(schedule.night || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.meal_timing || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.specific_timing || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.frequency || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.duration || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{o.as_needed ? "Yes" : ""}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.indication || "")}</td>
                    <td className="px-3 py-2 text-slate-600">{String(o.additional_instructions || "")}</td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-slate-100">
                  <td colSpan={13} className="px-3 py-2 italic text-slate-400">{String(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return renderClinicalValue(prescriptions);
}

function EhrSection({ title, code, children }: { title: string; code?: string; children: ReactNode }) {
  return (
    <section data-ehr-section className="border-t-2 border-[#17312d] pt-3">
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
  if (hasValue(subjective.current_medicines)) items.push({ label: "Current medicines", value: subjective.current_medicines });
  if (hasValue(assessment.clinical_impression)) items.push({ label: "Impression", value: assessment.clinical_impression });
  if (hasValue(assessment.provisional_diagnoses) || hasValue(assessment.confirmed_diagnoses)) {
    items.push({ label: "Diagnosis", value: assessment.provisional_diagnoses || assessment.confirmed_diagnoses });
  }
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
  const location = useLocation();
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

    fetch(apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(patientId)}`))
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
    navigate("/clinic/look");
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
      const response = await fetch(apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(patientId)}/encounters/${encodeURIComponent(encounterId)}/pdf`));
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
    hasValue(subjective.symptoms) ||
    hasValue(subjective.associated_symptoms) ||
    hasValue(subjective.relevant_negatives) ||
    hasValue(subjective.medical_conditions) ||
    hasValue(subjective.previous_surgeries) ||
    hasValue(subjective.allergies) ||
    hasValue(subjective.current_medicines) ||
    hasValue(subjective.family_history) ||
    hasValue(subjective.social_history)
  );

  const hasObjectiveContent = isSoap && (
    hasValue(objective.vitals) ||
    hasValue(objective.examination_findings) ||
    hasValue(objective.available_test_results)
  );

  const hasAssessmentContent = isSoap && (
    hasValue(assessment.clinical_impression) ||
    hasValue(assessment.diagnosis_status) ||
    hasValue(assessment.provisional_diagnoses) ||
    hasValue(assessment.confirmed_diagnoses) ||
    hasValue(assessment.differential_diagnoses)
  );

  const hasPlanContent = isSoap && (
    hasValue(plan.prescriptions) ||
    hasValue(plan.tests_ordered) ||
    hasValue(plan.procedures) ||
    hasValue(plan.treatment_advice) ||
    hasValue(plan.diet_and_hydration_advice) ||
    hasValue(plan.referrals) ||
    hasValue(plan.follow_up) ||
    hasValue(plan.warning_signs) ||
    hasValue(plan.other_instructions)
  );

  const legacyEntries = Object.entries(ehr).filter(
    ([key]) => !["schema_version", "visit_details", "approval", "subjective", "objective", "assessment", "plan", "additional_clinical_information", "private_doctor_notes"].includes(key)
  );

  return (
    <div className="min-h-screen bg-[#e8ecea]">
      <style>{PAGE_CSS}</style>

      {/* Sticky Action Bar */}
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
            {!isApproved ? (
              <Button variant="outline" size="sm" className="border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
                onClick={() => navigate("/doctor-dashboard/consultation-transcript", {
                  state: {
                    editEncounter: {
                      encounterId,
                      clinicId,
                      patientId,
                      patientName: patient.name,
                      patientPhone: patient.phone,
                      doctorId: encounter.doctor_id,
                    }
                  }
                })}>
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Edit EHR
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="border-purple-300 bg-white text-purple-700 hover:bg-purple-50">
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Add Addendum
              </Button>
            )}
          </div>
        </div>
        {pdfError ? (
          <div className="mx-auto max-w-4xl px-4 pb-2">
            <p role="alert" className="text-sm font-semibold text-red-600">{pdfError}</p>
          </div>
        ) : null}
      </div>

      {/* Document Container */}
      <div className="ehr-page-wrapper mx-auto max-w-4xl px-4 py-6 sm:py-8">
        <div ref={docRef} className="ehr-document mx-auto overflow-hidden rounded-sm border border-slate-300 bg-white text-slate-900 shadow-lg">
          {/* Document Header */}
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
            {/* Patient and Visit Information */}
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

            {/* Clinical Snapshot */}
            <ClinicalSnapshot encounter={encounter} patient={patient} />

            {/* Full SOAP EHR */}
            {isSoap ? (
              <>
                {hasSubjectiveContent ? (
                  <EhrSection code="S" title="Subjective \u2014 Patient history">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {renderField("Chief complaints", subjective.chief_complaints)}
                      {renderField("History of present illness", subjective.history_of_present_illness)}
                      <div className="sm:col-span-2">
                        {(() => {
                          const s = renderSymptomsTable(subjective.symptoms);
                          if (!s && isImportantField("symptoms")) {
                            return (
                              <div className="border-b border-slate-200 pb-3">
                                <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Symptoms</dt>
                                <dd className="mt-1.5 text-sm italic text-slate-400">No symptoms recorded</dd>
                              </div>
                            );
                          }
                          return s ? (
                            <div className="border-b border-slate-200 pb-3">
                              <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Symptoms</dt>
                              <dd className="mt-1.5">{s}</dd>
                            </div>
                          ) : null;
                        })()}
                      </div>
                      {renderField("Associated symptoms", subjective.associated_symptoms)}
                      {renderField("Relevant negatives", subjective.relevant_negatives)}
                      {renderField("Medical conditions", subjective.medical_conditions)}
                      {renderField("Previous surgeries", subjective.previous_surgeries)}
                      {renderField("Allergies", subjective.allergies)}
                      {renderField("Current medicines", subjective.current_medicines)}
                      {renderField("Family history", subjective.family_history)}
                      {renderField("Social history", subjective.social_history)}
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
                      ) : (
                        <div className="border-b border-slate-200 pb-3">
                          <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Vitals and measurements</dt>
                          <dd className="mt-1.5 text-sm italic text-slate-400">No vitals recorded</dd>
                        </div>
                      )}
                      {renderField("Examination findings", objective.examination_findings)}
                      {renderField("Available test results", objective.available_test_results)}
                    </dl>
                  </EhrSection>
                ) : null}

                {hasAssessmentContent ? (
                  <EhrSection code="A" title="Assessment \u2014 Clinical opinion">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {renderField("Clinical impression", assessment.clinical_impression)}
                      {renderField("Diagnosis status", assessment.diagnosis_status)}
                      {renderField("Provisional diagnoses", assessment.provisional_diagnoses)}
                      {renderField("Confirmed diagnoses", assessment.confirmed_diagnoses)}
                      {renderFieldWide("Differential diagnoses", assessment.differential_diagnoses)}
                    </dl>
                  </EhrSection>
                ) : null}

                {hasPlanContent ? (
                  <EhrSection code="P" title="Plan \u2014 Treatment and follow-up">
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        {(() => {
                          const p = renderPrescriptionsTable(plan.prescriptions);
                          if (!p && isImportantField("prescriptions")) {
                            return (
                              <div className="border-b border-slate-200 pb-3">
                                <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Prescriptions</dt>
                                <dd className="mt-1.5 text-sm italic text-slate-400">No medicines prescribed</dd>
                              </div>
                            );
                          }
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
                      {renderField("Diet and hydration advice", plan.diet_and_hydration_advice)}
                      {renderField("Referrals", plan.referrals)}
                      {renderField("Follow-up", plan.follow_up)}
                      {renderField("Warning signs", plan.warning_signs)}
                      {renderField("Other instructions", plan.other_instructions)}
                    </dl>
                  </EhrSection>
                ) : null}

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

            {/* Approval Footer */}
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
                  <p>Generated with {encounter.model_name || "clinical documentation system"}</p>
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
