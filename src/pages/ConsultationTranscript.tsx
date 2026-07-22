import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle, Apple, ArrowLeft, Check, FileAudio, FlaskConical, ListChecks,
  Loader2, Pill, RotateCcw, Save, ShieldCheck, Sparkles, Stethoscope, UserRound, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api";
import { clearConsultationRecording, getConsultationRecording } from "@/lib/consultationRecording";

type TranscriptSegment = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

type EhrEncounter = {
  encounter_id: string;
  status: "draft" | "approved";
  ehr_data: Record<string, unknown>;
  patient_summary: Record<string, unknown>;
  model_name?: string;
  approved_at?: string | null;
};

const summaryFields = [
  ["visit_overview", "What the doctor found", "text"],
  ["medicines", "Medicines", "list"],
  ["tests", "Tests", "list"],
  ["diet_advice", "Diet and hydration advice", "list"],
  ["doctor_suggestions", "Doctor suggestions", "list"],
  ["instructions", "Other instructions", "list"],
  ["follow_up", "Follow-up", "text"],
  ["warning_signs", "When to seek help", "list"],
] as const;

function summaryList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function editableValue(value: unknown, kind: "text" | "list" | "object") {
  if (kind === "list") return Array.isArray(value) ? value.join("\n") : "";
  if (kind === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join("\n");
  }
  return typeof value === "string" ? value : "";
}

function parsedEditableValue(value: string, kind: "text" | "list" | "object") {
  if (kind === "list") return value.split("\n").map((item) => item.trim()).filter(Boolean);
  if (kind === "object") {
    return value.split("\n").reduce<Record<string, string>>((result, line) => {
      const separator = line.indexOf(":");
      if (separator > 0) result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      return result;
    }, {});
  }
  return value.trim() || null;
}

function formatTime(seconds: number) {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(wholeSeconds / 60).toString().padStart(2, "0")}:${(wholeSeconds % 60).toString().padStart(2, "0")}`;
}

function combineConsecutiveSpeakerTurns(input: TranscriptSegment[]) {
  return input.reduce<TranscriptSegment[]>((combined, segment) => {
    const text = segment.text?.trim();
    if (!text) return combined;
    const previous = combined[combined.length - 1];
    if (previous?.speaker === segment.speaker) {
      previous.text = `${previous.text.trim()} ${text}`;
      previous.end = Math.max(previous.end, segment.end);
      return combined;
    }
    combined.push({ ...segment, text });
    return combined;
  }, []);
}

function isSoapFormat(data: Record<string, unknown>): boolean {
  return !!(data.schema_version || data.subjective || data.visit_details);
}

function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasValue);
  return String(value).trim().length > 0;
}

function fieldLabel(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()).replace("Spo2", "SpO2").replace("Bmi", "BMI");
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function renderClinicalValue(value: unknown, depth = 0): ReactNode {
  if (!hasValue(value)) return null;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number" || typeof value === "string") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    const items = value.filter(hasValue);
    if (!items.length) return null;
    return <ul className="space-y-1">{items.map((item, i) => <li key={i} className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1a5c4a]" /><span>{renderClinicalValue(item, depth + 1)}</span></li>)}</ul>;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).filter(([, v]) => hasValue(v));
  if (!entries.length) return null;
  if ("value" in obj && ("unit" in obj || "source" in obj)) {
    const parts = [hasValue(obj.value) ? String(obj.value) : "", hasValue(obj.unit) ? String(obj.unit) : ""].filter(Boolean);
    const valStr = parts.join(" ");
    const src = hasValue(obj.source) ? String(obj.source) : "";
    return <span><strong>{valStr}</strong>{src ? <span className="ml-1 text-xs text-slate-500">({src})</span> : null}</span>;
  }
  if ("systolic" in obj || "diastolic" in obj) {
    return <span className="font-semibold">{hasValue(obj.systolic) ? String(obj.systolic) : "-"}/{hasValue(obj.diastolic) ? String(obj.diastolic) : "-"}</span>;
  }
  return <div className={depth > 0 ? "ml-2 space-y-0.5" : "space-y-1"}>{entries.map(([k, v]) => { const rendered = renderClinicalValue(v, depth + 1); return rendered ? <div key={k}>{depth < 2 ? <div><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{fieldLabel(k)}</span><div className="mt-0.5">{rendered}</div></div> : <div className="text-sm"><strong>{fieldLabel(k)}:</strong> {rendered}</div>}</div> : null; })}</div>;
}

function renderSymptomsTable(symptoms: unknown): ReactNode {
  if (!hasValue(symptoms)) return null;
  if (Array.isArray(symptoms)) {
    const items = symptoms.filter(hasValue);
    if (!items.length) return null;
    if (items.every((i) => typeof i === "string" || typeof i === "number")) return renderClinicalValue(symptoms);
    return <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr className="border-b border-slate-300 bg-slate-50"><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Symptom</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Duration</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Severity</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Source</th></tr></thead><tbody>{items.map((item, i) => { if (typeof item === "object" && item !== null) { const o = item as Record<string, unknown>; return <tr key={i} className="border-b border-slate-100"><td className="px-3 py-2 font-medium">{String(o.name || o.symptom_name || o.symptom || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.duration || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.severity || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.source || "")}</td></tr>; } return <tr key={i} className="border-b border-slate-100"><td colSpan={4} className="px-3 py-2">{String(item)}</td></tr>; })}</tbody></table></div>;
  }
  return renderClinicalValue(symptoms);
}

function renderVitalsGrid(vitals: unknown): ReactNode {
  if (!hasValue(vitals)) return null;
  if (typeof vitals === "object" && !Array.isArray(vitals)) {
    const obj = vitals as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, v]) => hasValue(v));
    if (!entries.length) return null;
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">{entries.map(([key, val]) => { const label = fieldLabel(key); let displayValue = ""; let source = ""; if (typeof val === "object" && val !== null) { const v = val as Record<string, unknown>; if ("value" in v && "unit" in v) displayValue = `${String(v.value)}${v.unit ? " " + String(v.unit) : ""}`; else if ("systolic" in v || "diastolic" in v) displayValue = `${hasValue(v.systolic) ? String(v.systolic) : "-"}/${hasValue(v.diastolic) ? String(v.diastolic) : "-"}`; else if ("value" in v) displayValue = String(v.value); else displayValue = Object.values(v).filter(hasValue).join(", "); if (hasValue(v.source)) source = String(v.source); } else displayValue = String(val); return <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wide text-[#58716a]">{label}</div><div className="mt-0.5 text-base font-bold text-slate-800">{displayValue || "\u2014"}</div>{source ? <div className="mt-0.5 text-[10px] text-slate-500">Source: {source}</div> : null}</div>; })}</div>;
  }
  return renderClinicalValue(vitals);
}

function renderPrescriptionsTable(prescriptions: unknown): ReactNode {
  if (!hasValue(prescriptions)) return null;
  if (Array.isArray(prescriptions)) {
    const items = prescriptions.filter(hasValue);
    if (!items.length) return null;
    const hasDetails = items.some((i) => typeof i === "object" && i !== null && ("dose" in i || "frequency" in i || "strength" in i || "duration" in i));
    if (!hasDetails) return renderClinicalValue(prescriptions);
    return <div className="overflow-x-auto"><table className="w-full border-collapse text-xs"><thead><tr className="border-b border-slate-300 bg-slate-50"><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Medicine</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Strength</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Dose</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Frequency</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Duration</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Timing</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">PRN</th><th className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[#58716a]">Indication</th></tr></thead><tbody>{items.map((item, i) => { if (typeof item === "object" && item !== null) { const o = item as Record<string, unknown>; return <tr key={i} className="border-b border-slate-100"><td className="px-3 py-2 font-medium">{String(o.medicine_name || o.name || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.strength || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.dose || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.frequency || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.duration || "")}</td><td className="px-3 py-2 text-slate-600">{String(o.specific_timing || o.meal_timing || "")}</td><td className="px-3 py-2 text-slate-600">{o.as_needed ? "Yes" : ""}</td><td className="px-3 py-2 text-slate-600">{String(o.indication || "")}</td></tr>; } return <tr key={i} className="border-b border-slate-100"><td colSpan={8} className="px-3 py-2 italic text-slate-400">{String(item)}</td></tr>; })}</tbody></table></div>;
  }
  return renderClinicalValue(prescriptions);
}

function EhrSection({ title, code, children }: { title: string; code?: string; children: ReactNode }) {
  return <section className="border-t-2 border-[#17312d] pt-3"><div className="mb-4 flex items-center gap-2">{code ? <span className="grid h-7 w-7 place-items-center rounded-md bg-[#17312d] text-xs font-black text-white">{code}</span> : null}<h3 className="text-sm font-black uppercase tracking-[0.13em] text-[#17312d]">{title}</h3></div>{children}</section>;
}

export default function ConsultationTranscript() {
  const navigate = useNavigate();
  const recording = useMemo(() => getConsultationRecording(), []);
  const [audioUrl, setAudioUrl] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [processingStage, setProcessingStage] = useState<"idle" | "transcribing" | "generating" | "complete">("idle");
  const [ehr, setEhr] = useState<EhrEncounter | null>(null);
  const [isSavingEhr, setIsSavingEhr] = useState(false);
  const [ehrNotice, setEhrNotice] = useState("");
  const [error, setError] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const url = URL.createObjectURL(recording.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  useEffect(() => {
    if (recording && processingStage === "idle") {
      transcribe();
    }
  }, [recording]);

  function setSoapField(path: string, value: unknown) {
    setEhr((current) => {
      if (!current) return current;
      const parts = path.split(".");
      const newData = JSON.parse(JSON.stringify(current.ehr_data));
      let obj: Record<string, unknown> = newData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") obj[parts[i]] = {};
        obj = obj[parts[i]] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]] = value;
      return { ...current, ehr_data: newData };
    });
    setEhrNotice("");
  }

  function updateListField(path: string, value: string) {
    const items = value.split("\n").map((s) => s.trim()).filter(Boolean);
    setSoapField(path, items);
  }

  async function transcribe() {
    if (!recording) return;
    setProcessingStage("transcribing");
    setError("");
    try {
      const extension = recording.blob.type.includes("ogg") ? "ogg" : recording.blob.type.includes("mp4") ? "m4a" : "webm";
      const formData = new FormData();
      formData.append("audio", recording.blob, `consultation-${Date.now()}.${extension}`);
      const response = await fetch(apiUrl("/api/ai/transcribe-consultation"), {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "The recording could not be transcribed.");
      const combined = combineConsecutiveSpeakerTurns(payload.segments || []);
      setSegments(combined);
      setProcessingStage("generating");
      generateEhrDraft(combined);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "The recording could not be transcribed.";
      setError(message === "Failed to fetch" ? "The Karma backend is not running or cannot be reached on port 8082." : message);
      setProcessingStage("idle");
    }
  }

  async function generateEhrDraft(segmentsOverride?: TranscriptSegment[]) {
    const segs = segmentsOverride || segments;
    if (!recording || !segs.length) return;
    if (!recording.patient.id || !recording.patient.clinicId) {
      setError("Choose a registered patient from the clinic queue before generating an EHR.");
      setProcessingStage("idle");
      return;
    }
    setError("");
    setEhrNotice("");
    try {
      const response = await fetch(apiUrl("/api/ehr/drafts/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: recording.patient.clinicId,
          patient_id: recording.patient.id,
          patient_name: recording.patient.name,
          patient_phone: recording.patient.phone || null,
          patient_email: recording.patient.email || null,
          doctor_id: recording.patient.doctorId || null,
          appointment_id: recording.patient.appointmentId || null,
          transcript_segments: segs,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "The EHR draft could not be generated.");
      setEhr(payload);
      setProcessingStage("complete");
      setEhrNotice("Local AI draft generated. Review every field before approval.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The EHR draft could not be generated.");
      setProcessingStage("idle");
    }
  }

  function updateEhrField(section: "ehr_data" | "patient_summary", field: string, kind: "text" | "list" | "object", value: string) {
    setEhr((current) => current ? { ...current, [section]: { ...current[section], [field]: parsedEditableValue(value, kind) } } : current);
    setEhrNotice("");
  }

  async function saveEhrDraft() {
    if (!recording?.patient.clinicId || !ehr) return;
    setIsSavingEhr(true);
    setError("");
    try {
      const response = await fetch(apiUrl(`/api/ehr/encounters/${encodeURIComponent(ehr.encounter_id)}?clinic_id=${encodeURIComponent(recording.patient.clinicId)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ehr_data: ehr.ehr_data, patient_summary: ehr.patient_summary, actor_id: recording.patient.doctorId || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not save the EHR draft.");
      setEhr(payload);
      setEhrNotice("Draft saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save the EHR draft.");
    } finally {
      setIsSavingEhr(false);
    }
  }

  async function approveEhr() {
    if (!recording?.patient.clinicId || !recording.patient.doctorId || !ehr) {
      setError("A selected clinic doctor is required to approve this EHR.");
      return;
    }
    setIsSavingEhr(true);
    setError("");
    try {
      const saveResponse = await fetch(apiUrl(`/api/ehr/encounters/${encodeURIComponent(ehr.encounter_id)}?clinic_id=${encodeURIComponent(recording.patient.clinicId)}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ehr_data: ehr.ehr_data, patient_summary: ehr.patient_summary, actor_id: recording.patient.doctorId }),
      });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saved.detail || "Could not save the reviewed EHR.");
      const response = await fetch(apiUrl(`/api/ehr/encounters/${encodeURIComponent(ehr.encounter_id)}/approve?clinic_id=${encodeURIComponent(recording.patient.clinicId)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: recording.patient.doctorId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not approve the EHR.");
      setEhr(payload);
      setEhrNotice("EHR approved and added to the patient record.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not approve the EHR.");
    } finally {
      setIsSavingEhr(false);
    }
  }

  function discardAndReturn() {
    clearConsultationRecording();
    navigate("/doctor-dashboard");
  }

  const isSoap = ehr ? isSoapFormat(ehr.ehr_data) : false;
  const subjective = (isSoap ? asRecord(ehr!.ehr_data.subjective) : {}) as Record<string, unknown>;
  const objective = (isSoap ? asRecord(ehr!.ehr_data.objective) : {}) as Record<string, unknown>;
  const assessment = (isSoap ? asRecord(ehr!.ehr_data.assessment) : {}) as Record<string, unknown>;
  const plan = (isSoap ? asRecord(ehr!.ehr_data.plan) : {}) as Record<string, unknown>;

  if (!recording) {
    return (
      <main className="min-h-screen bg-[#f5f0e7] px-4 py-12">
        <div className="mx-auto max-w-xl rounded-[28px] bg-white p-8 text-center shadow-sm">
          <FileAudio className="mx-auto h-12 w-12 text-[#1a5c4a]" />
          <h1 className="mt-4 text-2xl font-black text-[#202825]">No consultation recording found</h1>
          <p className="mt-2 text-sm text-[#68736f]">Return to the doctor dashboard and record a consultation first.</p>
          <Button asChild className="mt-6 bg-[#1a5c4a] hover:bg-[#144a3c]"><Link to="/doctor-dashboard">Return to dashboard</Link></Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f0e7] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={discardAndReturn} className="inline-flex items-center gap-2 text-sm font-bold text-[#1a5c4a]">
          <ArrowLeft className="h-4 w-4" /> Doctor dashboard
        </button>

        <div className="mt-5 overflow-hidden rounded-[30px] border border-white/80 bg-white/85 shadow-[0_24px_70px_-50px_rgba(18,64,54,0.7)]">
          <header className="border-b border-[#e5ded4] px-5 py-5 md:px-8">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1a5c4a]">Voice-to-English test</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-[#202825] md:text-3xl">Consultation transcript</h1>
                <p className="mt-1 text-sm text-[#68736f]">{recording.patient.name}{recording.patient.token ? ` · ${recording.patient.token}` : ""} · {formatTime(recording.durationSeconds)}</p>
              </div>
              <span className="rounded-full bg-[#edf8f3] px-3 py-1.5 text-xs font-bold text-[#1a5c4a]">Sarvam · Saaras v3</span>
            </div>
          </header>

          <div className="grid gap-6 p-5 md:p-8 lg:grid-cols-[320px_1fr]">
            <aside>
              <div className="rounded-2xl bg-[#17312d] p-4 text-white">
                <p className="text-sm font-bold">Recorded audio</p>
                <p className="mt-1 text-xs text-white/55">Replay it before sending it for Sarvam transcription.</p>
                {audioUrl && <audio className="mt-4 w-full" controls src={audioUrl} />}
              </div>

              {processingStage === "transcribing" || processingStage === "generating" ? (
                <div className="mt-4 rounded-2xl border border-[#e0e7e3] bg-white p-5 text-center shadow-sm">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1a5c4a]" />
                  <p className="mt-3 text-sm font-bold text-[#202825]">
                    {processingStage === "transcribing" ? "Transcribing consultation..." : "Building EHR draft..."}
                  </p>
                  <p className="mt-1 text-xs text-[#68736f]">This may take 1–2 minutes. Keep this page open.</p>
                </div>
              ) : processingStage === "idle" && !ehr ? (
                <div className="mt-4 rounded-2xl border border-[#eadfca] bg-[#fffaf0] p-4">
                  <p className="text-sm font-bold text-[#5f4b24]">Ready to process</p>
                  <p className="mt-1 text-xs leading-5 text-[#74684f]">Processing will start automatically.</p>
                  <Button onClick={transcribe} className="mt-4 w-full bg-[#1a5c4a] hover:bg-[#144a3c]"><Sparkles className="mr-2 h-4 w-4" /> Start processing</Button>
                </div>
              ) : null}

              <button type="button" onClick={discardAndReturn} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#d9d2c8] px-3 py-2.5 text-xs font-bold text-[#58645f]">
                <RotateCcw className="h-4 w-4" /> Discard and record again
              </button>
            </aside>

            <section>
              {error && (
                <div className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p>{error}</p>
                </div>
              )}

              {processingStage === "transcribing" || processingStage === "generating" ? (
                <div className="grid min-h-[360px] place-items-center rounded-2xl bg-[#fbfaf7] text-center">
                  <div>
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#1a5c4a]" />
                    <p className="mt-4 font-bold text-[#202825]">
                      {processingStage === "transcribing" ? "Transcribing consultation audio..." : "Generating EHR from transcript..."}
                    </p>
                    <p className="mt-1 text-sm text-[#68736f]">The transcript and EHR are being prepared.</p>
                  </div>
                </div>
              ) : processingStage === "idle" && !ehr ? (
                <div className="grid min-h-[360px] place-items-center rounded-2xl border-2 border-dashed border-[#d8d1c7] bg-[#fbfaf7] p-8 text-center">
                  <div><FileAudio className="mx-auto h-12 w-12 text-[#8ba69d]" /><p className="mt-4 font-bold text-[#202825]">Ready to process consultation</p><p className="mt-2 max-w-md text-sm leading-6 text-[#68736f]">Recording captured. Processing will begin automatically.</p></div>
                </div>
              ) : ehr ? (
                <div>
                  {segments.length > 0 ? (
                    <div className="mb-3 flex items-center justify-end">
                      <button onClick={() => setShowTranscript(!showTranscript)} className="flex items-center gap-1 text-xs font-bold text-[#1a5c4a] hover:underline">
                        {showTranscript ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {showTranscript ? "Hide" : "Show"} transcript ({segments.length} segments)
                      </button>
                    </div>
                  ) : null}

                  {showTranscript && segments.length > 0 ? (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-[#e5ded4] bg-white">
                      <div className="border-b border-[#e5ded4] bg-[#fbfaf7] px-4 py-3">
                        <p className="text-sm font-black text-[#202825]">Complete conversation</p>
                      </div>
                      <div className="divide-y divide-[#e5ded4]">
                        {segments.map((segment, index) => (
                          <div key={`${segment.start}-${index}`} className="p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#40514b]"><UserRound className="h-4 w-4 text-[#1a5c4a]" />{segment.speaker}</p>
                              <span className="text-[11px] font-bold text-[#8b8a84]">{formatTime(segment.start)}–{formatTime(segment.end)}</span>
                            </div>
                            <textarea value={segment.text} onChange={(event) => setSegments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} className="mt-3 min-h-[72px] w-full resize-y rounded-xl border border-transparent bg-transparent p-2 text-sm leading-6 text-[#202825] outline-none focus:border-[#9acdbb] focus:bg-white" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {ehrNotice ? <p className="mb-4 rounded-xl bg-[#edf8f3] p-3 text-xs font-bold text-[#1a5c4a]">{ehrNotice}</p> : null}

                  {isSoap ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-lg">
                      <header className="border-b-4 border-[#1a5c4a] bg-[#17312d] px-5 py-5 text-white sm:px-8">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2"><Stethoscope className="h-6 w-6 text-[#9de1ca]" /><h2 className="text-xl font-black tracking-tight">{recording.patient.name}</h2></div>
                            <p className="mt-1 text-xs text-white/70">{recording.patient.clinicName || "Clinic"}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#9de1ca]">Electronic Health Record</p>
                            <p className="mt-1 font-mono text-xs text-white/75">{ehr.encounter_id}</p>
                            <span className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase bg-amber-300 text-amber-950">DRAFT</span>
                          </div>
                        </div>
                      </header>

                      <div className="space-y-6 px-5 py-5 sm:px-8">
                        <section className="grid gap-0 overflow-hidden rounded-lg border border-slate-300 sm:grid-cols-2">
                          <div className="border-b border-slate-300 bg-slate-50 p-4 sm:border-b-0 sm:border-r">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Patient</p>
                            <p className="mt-2 text-lg font-black">{recording.patient.name}</p>
                            <p className="mt-1 text-xs text-slate-600">{recording.patient.phone || ""}</p>
                          </div>
                          <div className="p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Visit</p>
                            <p className="mt-2 text-sm font-black">{recording.patient.token ? `Token: ${recording.patient.token}` : "Walk-in"}</p>
                            <p className="mt-1 text-xs text-slate-600">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                        </section>

                        {hasValue(subjective.chief_complaints) || hasValue(subjective.history_of_present_illness) || hasValue(subjective.symptoms) || hasValue(subjective.relevant_negatives) || hasValue(subjective.medical_conditions) || hasValue(subjective.allergies) || hasValue(subjective.current_medicines) || hasValue(subjective.family_history) ? (
                          <EhrSection code="S" title="Subjective — Patient history">
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {["chief_complaints", "history_of_present_illness", "symptoms", "relevant_negatives", "medical_conditions", "previous_surgeries", "allergies", "current_medicines", "family_history", "social_history"].map((field) => {
                                const val = subjective[field];
                                if (field === "symptoms") {
                                  const rendered = renderSymptomsTable(val);
                                  return <div key={field} className="sm:col-span-2">{rendered ? <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Symptoms</dt><dd className="mt-1.5">{rendered}</dd></div> : <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Symptoms</dt><dd className="mt-1.5"><textarea value="" onChange={() => {}} placeholder="No symptoms recorded" className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm italic text-slate-400 outline-none focus:ring-0" /></dd></div>}</div>;
                                }
                                if (field === "chief_complaints") {
                                  return <div key={field} className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Chief complaints</dt><dd className="mt-1.5">{typeof val === "string" ? <EditableText value={val} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : Array.isArray(val) ? <EditableList value={val} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : <textarea value="" onChange={() => {}} placeholder="Not mentioned" className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm italic text-slate-400 outline-none focus:ring-0" />}</dd></div></div>;
                                }
                                if (field === "relevant_negatives") {
                                  return <div key={field} className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Relevant negatives</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : <textarea value="" onChange={() => {}} placeholder="No negatives recorded" className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm italic text-slate-400 outline-none focus:ring-0" />}</dd></div></div>;
                                }
                                return hasValue(val) || field === "allergies" || field === "current_medicines" || field === "medical_conditions" ? (
                                  <div key={field} className={field === "history_of_present_illness" ? "sm:col-span-2" : ""}>
                                    <div className="border-b border-slate-200 pb-3">
                                      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(field)}</dt>
                                      <dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : <EditableText value={typeof val === "string" ? val : ""} onChange={(v) => setSoapField(`subjective.${field}`, v)} />}</dd>
                                    </div>
                                  </div>
                                ) : null;
                              })}
                            </div>
                          </EhrSection>
                        ) : null}

                        {hasValue(objective.vitals) || hasValue(objective.examination_findings) ? (
                          <EhrSection code="O" title="Objective — Clinical findings">
                            <div className="space-y-3">
                              {hasValue(objective.vitals) ? <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Vitals and measurements</dt><dd className="mt-1.5">{renderVitalsGrid(objective.vitals)}</dd></div> : null}
                              {hasValue(objective.examination_findings) ? <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Examination findings</dt><dd className="mt-1.5"><EditableList value={objective.examination_findings as string[]} onChange={(v) => setSoapField("objective.examination_findings", v)} /></dd></div> : null}
                              {hasValue(objective.available_test_results) ? <div><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Available test results</dt><dd className="mt-1.5"><EditableList value={objective.available_test_results as string[]} onChange={(v) => setSoapField("objective.available_test_results", v)} /></dd></div> : null}
                            </div>
                          </EhrSection>
                        ) : null}

                        {hasValue(assessment.clinical_impression) || hasValue(assessment.provisional_diagnoses) || hasValue(assessment.confirmed_diagnoses) ? (
                          <EhrSection code="A" title="Assessment — Clinical opinion">
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {(assessment.diagnosis_status ? <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Diagnosis status</dt><dd className="mt-1.5 text-sm font-bold">{String(assessment.diagnosis_status)}</dd></div></div> : null)}
                              {["clinical_impression", "provisional_diagnoses", "confirmed_diagnoses", "differential_diagnoses"].map((field) => {
                                const val = assessment[field];
                                return hasValue(val) ? <div key={field} className={field === "differential_diagnoses" ? "sm:col-span-2" : ""}><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(field)}</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val as string[]} onChange={(v) => setSoapField(`assessment.${field}`, v)} /> : <EditableText value={typeof val === "string" ? val : ""} onChange={(v) => setSoapField(`assessment.${field}`, v)} />}</dd></div></div> : null;
                              })}
                            </div>
                          </EhrSection>
                        ) : null}

                        {hasValue(plan.prescriptions) || hasValue(plan.treatment_advice) || hasValue(plan.follow_up) || hasValue(plan.warning_signs) ? (
                          <EhrSection code="P" title="Plan — Treatment and follow-up">
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {hasValue(plan.prescriptions) ? <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Prescriptions</dt><dd className="mt-1.5">{renderPrescriptionsTable(plan.prescriptions)}</dd></div></div> : null}
                              {["tests_ordered", "procedures", "treatment_advice", "diet_and_hydration_advice", "referrals", "other_instructions"].map((field) => {
                                const val = plan[field];
                                return hasValue(val) ? <div key={field} className={field === "other_instructions" ? "sm:col-span-2" : ""}><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(field)}</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val as string[]} onChange={(v) => setSoapField(`plan.${field}`, v)} /> : <EditableText value={typeof val === "string" ? val : ""} onChange={(v) => setSoapField(`plan.${field}`, v)} />}</dd></div></div> : null;
                              })}
                              {hasValue(plan.follow_up) ? <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Follow-up</dt><dd className="mt-1.5">{typeof plan.follow_up === "object" ? <EditableText value={JSON.stringify(plan.follow_up, null, 2)} onChange={(v) => { try { setSoapField("plan.follow_up", JSON.parse(v)); } catch { setSoapField("plan.follow_up", v); } }} /> : <EditableText value={String(plan.follow_up || "")} onChange={(v) => setSoapField("plan.follow_up", v)} />}</dd></div></div> : null}
                              {hasValue(plan.warning_signs) ? <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Warning signs</dt><dd className="mt-1.5">{typeof plan.warning_signs === "object" ? <EditableText value={JSON.stringify(plan.warning_signs, null, 2)} onChange={(v) => { try { setSoapField("plan.warning_signs", JSON.parse(v)); } catch { setSoapField("plan.warning_signs", v); } }} /> : <EditableList value={Array.isArray(plan.warning_signs) ? plan.warning_signs as string[] : []} onChange={(v) => setSoapField("plan.warning_signs", v)} />}</dd></div></div> : null}
                            </div>
                          </EhrSection>
                        ) : null}

                        {hasValue(ehr.ehr_data.additional_clinical_information) ? (
                          <EhrSection title="Additional clinical information"><div className="grid gap-x-6 gap-y-3 sm:grid-cols-2"><div className="sm:col-span-2">{Array.isArray(ehr.ehr_data.additional_clinical_information) ? <EditableList value={ehr.ehr_data.additional_clinical_information as string[]} onChange={(v) => setSoapField("additional_clinical_information", v)} /> : <EditableText value={typeof ehr.ehr_data.additional_clinical_information === "string" ? ehr.ehr_data.additional_clinical_information : ""} onChange={(v) => setSoapField("additional_clinical_information", v)} />}</div></div></EhrSection>
                        ) : null}

                        <footer className="rounded-lg border border-[#b9ddcf] bg-[#f4fbf8] p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#1a5c4a]"><ShieldCheck className="h-4 w-4" /> Clinical approval</p>
                              <p className="mt-1 text-sm font-bold text-amber-700">DRAFT — Awaiting doctor review and approval</p>
                              <p className="mt-0.5 text-xs text-slate-600">This is not a signed final medical record</p>
                            </div>
                            <div className="text-left text-[10px] text-slate-500 sm:text-right">
                              <p>Generated with {ehr.model_name || "clinical documentation system"}</p>
                            </div>
                          </div>
                        </footer>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 overflow-hidden rounded-2xl border border-[#b9ddcf] bg-[#f4fbf8]">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d5e9e1] px-4 py-4">
                        <div>
                          <p className="flex items-center gap-2 text-sm font-black text-[#17312d]"><ShieldCheck className="h-4 w-4" /> Doctor review</p>
                          <p className="mt-1 text-xs text-[#60766f]">{ehr.model_name || "gpt-oss:20b"} created this draft.</p>
                        </div>
                        <span className="rounded-full px-3 py-1 text-xs font-black bg-amber-100 text-amber-800">Unapproved draft</span>
                      </div>
                      <div className="p-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          {(Object.entries(ehr.ehr_data) as [string, unknown][]).filter(([, v]) => hasValue(v)).map(([key, val]) => (
                            <label key={key} className={typeof val === "object" && !Array.isArray(val) ? "md:col-span-2" : ""}>
                              <span className="text-xs font-bold text-[#40514b]">{fieldLabel(key)}</span>
                              <textarea
                                value={editableValue(val, Array.isArray(val) ? "list" : typeof val === "object" ? "object" : "text")}
                                onChange={(event) => updateEhrField("ehr_data", key, Array.isArray(val) ? "list" : typeof val === "object" ? "object" : "text", event.target.value)}
                                placeholder="Not mentioned"
                                className="mt-1 min-h-[82px] w-full rounded-xl border border-[#d5e3dd] bg-white p-3 text-sm leading-5 text-[#202825] outline-none focus:border-[#68ad94]"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-5 overflow-hidden rounded-2xl border border-[#b9ddcf] bg-[#f4fbf8]">
                    <div className="border-b border-[#d5e9e1] px-4 py-4">
                      <p className="text-sm font-black text-[#17312d]">Patient summary</p>
                      <p className="mt-1 text-xs text-[#60766f]">A simple version for the patient. They see it only after approval.</p>
                    </div>
                    <div className="p-4">
                      {typeof ehr.patient_summary.visit_overview === "string" && ehr.patient_summary.visit_overview ? <p className="rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-[#30443e]">{ehr.patient_summary.visit_overview}</p> : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {[
                          { field: "medicines", title: "Medicines", icon: Pill, tone: "bg-blue-50 text-blue-800" },
                          { field: "tests", title: "Tests", icon: FlaskConical, tone: "bg-violet-50 text-violet-800" },
                          { field: "diet_advice", title: "Diet & hydration", icon: Apple, tone: "bg-amber-50 text-amber-800" },
                          { field: "doctor_suggestions", title: "Doctor suggestions", icon: ListChecks, tone: "bg-[#edf8f3] text-[#1a5c4a]" },
                        ].map(({ field, title, icon: Icon, tone }) => {
                          const items = summaryList(ehr.patient_summary[field]);
                          return <div key={field} className={`rounded-xl p-3 ${tone}`}>
                            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><Icon className="h-4 w-4" />{title}</p>
                            {items.length ? <ul className="mt-2 space-y-1 text-sm leading-5">{items.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs opacity-70">Not discussed.</p>}
                          </div>;
                        })}
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {summaryFields.filter(([f]) => !["medicines", "tests", "diet_advice", "doctor_suggestions", "visit_overview"].includes(f)).map(([field, label, kind]) => (
                          <label key={field} className={field === "instructions" || field === "follow_up" ? "md:col-span-2" : ""}>
                            <span className="text-xs font-bold text-[#40514b]">{label}</span>
                            <textarea
                              value={editableValue(ehr.patient_summary[field], kind)}
                              onChange={(event) => updateEhrField("patient_summary", field, kind, event.target.value)}
                              placeholder="Not mentioned"
                              className="mt-1 min-h-[82px] w-full rounded-xl border border-[#d5e3dd] bg-white p-3 text-sm leading-5 text-[#202825] outline-none focus:border-[#68ad94]"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {ehr.status === "draft" ? (
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button variant="outline" onClick={saveEhrDraft} disabled={isSavingEhr}><Save className="mr-2 h-4 w-4" /> Save draft</Button>
                      <Button onClick={approveEhr} disabled={isSavingEhr} className="bg-[#1a5c4a] hover:bg-[#144a3c]"><ShieldCheck className="mr-2 h-4 w-4" /> Review complete — approve</Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function EditableText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <textarea
    value={value || ""}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder || "Not mentioned"}
    className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm leading-6 text-slate-800 outline-none focus:ring-0 focus:bg-white focus:border focus:border-[#9acdbb] focus:px-2 focus:py-1"
    rows={Math.max(1, (value || "").split("\n").length)}
  />;
}

function EditableList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const text = Array.isArray(value) ? value.join("\n") : "";
  return <textarea
    value={text}
    onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
    placeholder="One item per line"
    className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm leading-6 text-slate-800 outline-none focus:ring-0 focus:bg-white focus:border focus:border-[#9acdbb] focus:px-2 focus:py-1"
    rows={Math.max(1, text.split("\n").length)}
  />;
}
