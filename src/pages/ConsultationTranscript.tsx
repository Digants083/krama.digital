import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Apple, ArrowLeft, Check, FileAudio, FlaskConical, ListChecks, Loader2, Pill, RotateCcw, Save, ShieldCheck, Sparkles, UserRound } from "lucide-react";
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

const ehrFields = [
  ["chief_complaint", "Chief complaint", "text"],
  ["symptoms", "Symptoms", "list"],
  ["symptom_duration", "Symptom duration", "text"],
  ["medical_history", "Medical history", "list"],
  ["existing_conditions", "Existing conditions", "list"],
  ["allergies", "Allergies", "list"],
  ["current_medications", "Current medicines", "list"],
  ["vitals", "Vitals", "object"],
  ["examination_findings", "Examination findings", "list"],
  ["diagnoses", "Diagnosis / assessment", "list"],
  ["investigations", "Tests ordered", "list"],
  ["prescriptions", "Prescriptions", "list"],
  ["treatment_plan", "Treatment plan", "text"],
  ["follow_up", "Follow-up", "text"],
  ["warning_signs", "Warning signs", "list"],
  ["private_doctor_notes", "Private doctor notes", "text"],
] as const;

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

export default function ConsultationTranscript() {
  const navigate = useNavigate();
  const recording = useMemo(() => getConsultationRecording(), []);
  const [audioUrl, setAudioUrl] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [ehr, setEhr] = useState<EhrEncounter | null>(null);
  const [isGeneratingEhr, setIsGeneratingEhr] = useState(false);
  const [isSavingEhr, setIsSavingEhr] = useState(false);
  const [ehrNotice, setEhrNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recording) return;
    const url = URL.createObjectURL(recording.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  async function transcribe() {
    if (!recording) return;
    setIsTranscribing(true);
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
      setSegments(combineConsecutiveSpeakerTurns(payload.segments || []));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "The recording could not be transcribed.";
      setError(message === "Failed to fetch" ? "The Karma backend is not running or cannot be reached on port 8082." : message);
    } finally {
      setIsTranscribing(false);
    }
  }

  async function generateEhrDraft() {
    if (!recording || !segments.length) return;
    if (!recording.patient.id || !recording.patient.clinicId) {
      setError("Choose a registered patient from the clinic queue before generating an EHR.");
      return;
    }
    setIsGeneratingEhr(true);
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
          transcript_segments: segments,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "The EHR draft could not be generated.");
      setEhr(payload);
      setEhrNotice("Local AI draft generated. Review every field before approval.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The EHR draft could not be generated.");
    } finally {
      setIsGeneratingEhr(false);
    }
  }

  function updateEhrField(section: "ehr_data" | "patient_summary", field: string, kind: "text" | "list" | "object", value: string) {
    setEhr((current) => current ? {
      ...current,
      [section]: { ...current[section], [field]: parsedEditableValue(value, kind) },
    } : current);
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

              <div className="mt-4 rounded-2xl border border-[#eadfca] bg-[#fffaf0] p-4">
                <p className="text-sm font-bold text-[#5f4b24]">Before transcription</p>
                <p className="mt-1 text-xs leading-5 text-[#74684f]">Confirm the patient consented to recording. Sarvam will convert the multilingual audio into an English conversation and separate the speakers.</p>
                <p className="mt-2 text-[11px] font-bold text-[#816632]">Current rate: ₹45/hour · billed per second</p>
                <Button onClick={transcribe} disabled={isTranscribing || segments.length > 0} className="mt-4 w-full bg-[#1a5c4a] hover:bg-[#144a3c]">
                  {isTranscribing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Transcribing...</> : segments.length ? <><Check className="mr-2 h-4 w-4" /> Transcript generated</> : "Generate transcript"}
                </Button>
                {segments.length > 0 && !ehr ? (
                  <Button onClick={generateEhrDraft} disabled={isGeneratingEhr} className="mt-2 w-full bg-[#202825] hover:bg-[#101513]">
                    {isGeneratingEhr ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building EHR draft...</> : <><Sparkles className="mr-2 h-4 w-4" /> Generate EHR draft</>}
                  </Button>
                ) : null}
              </div>

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

              {!segments.length && !isTranscribing ? (
                <div className="grid min-h-[360px] place-items-center rounded-2xl border-2 border-dashed border-[#d8d1c7] bg-[#fbfaf7] p-8 text-center">
                  <div><FileAudio className="mx-auto h-12 w-12 text-[#8ba69d]" /><p className="mt-4 font-bold text-[#202825]">Your English conversation will appear here</p><p className="mt-2 max-w-md text-sm leading-6 text-[#68736f]">Sarvam will understand the supported Indian-language audio, translate it into English, and return timestamped sections for each detected speaker.</p></div>
                </div>
              ) : isTranscribing ? (
                <div className="grid min-h-[360px] place-items-center rounded-2xl bg-[#fbfaf7] text-center"><div><Loader2 className="mx-auto h-10 w-10 animate-spin text-[#1a5c4a]" /><p className="mt-4 font-bold text-[#202825]">Listening to the consultation...</p><p className="mt-1 text-sm text-[#68736f]">Keep this page open.</p></div></div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-[#e5ded4] bg-white">
                  <div className="border-b border-[#e5ded4] bg-[#fbfaf7] px-4 py-3">
                    <p className="text-sm font-black text-[#202825]">Complete conversation</p>
                    <p className="mt-0.5 text-xs text-[#68736f]">One continuous transcript, grouped whenever the speaker changes.</p>
                  </div>
                  <div className="divide-y divide-[#e5ded4]">
                    {segments.map((segment, index) => {
                      return (
                        <div key={`${segment.start}-${index}`} className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#40514b]"><UserRound className="h-4 w-4 text-[#1a5c4a]" />{segment.speaker}</p>
                            <span className="text-[11px] font-bold text-[#8b8a84]">{formatTime(segment.start)}–{formatTime(segment.end)}</span>
                          </div>
                          <textarea value={segment.text} onChange={(event) => setSegments((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} className="mt-3 min-h-[72px] w-full resize-y rounded-xl border border-transparent bg-transparent p-2 text-sm leading-6 text-[#202825] outline-none focus:border-[#9acdbb] focus:bg-white" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {ehr ? (
                <div className="mt-6 overflow-hidden rounded-2xl border border-[#b9ddcf] bg-[#f4fbf8]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d5e9e1] px-4 py-4">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-black text-[#17312d]"><ShieldCheck className="h-4 w-4" /> Doctor review</p>
                      <p className="mt-1 text-xs text-[#60766f]">{ehr.model_name || "gpt-oss:20b"} created this draft. Missing facts remain blank.</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${ehr.status === "approved" ? "bg-[#dff7e8] text-[#14633f]" : "bg-amber-100 text-amber-800"}`}>{ehr.status === "approved" ? "Approved" : "Unapproved draft"}</span>
                  </div>

                  <div className="p-4">
                    {ehrNotice ? <p className="mb-4 rounded-xl bg-white p-3 text-xs font-bold text-[#1a5c4a]">{ehrNotice}</p> : null}

                    <section className="rounded-2xl border border-[#d4e9df] bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e1f5ee] text-[#1a5c4a]"><Sparkles className="h-5 w-5" /></span>
                        <div>
                          <h2 className="font-black text-[#17312d]">Patient summary</h2>
                          <p className="mt-1 text-xs leading-5 text-[#60766f]">A simple version of the consultation. The patient sees it only after doctor approval.</p>
                        </div>
                      </div>
                      {typeof ehr.patient_summary.visit_overview === "string" && ehr.patient_summary.visit_overview ? <p className="mt-4 rounded-xl bg-[#f4fbf8] p-3 text-sm font-semibold leading-6 text-[#30443e]">{ehr.patient_summary.visit_overview}</p> : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {[
                          { field: "diet_advice", title: "Diet & hydration", icon: Apple, tone: "bg-amber-50 text-amber-800" },
                          { field: "doctor_suggestions", title: "Doctor suggestions", icon: ListChecks, tone: "bg-[#edf8f3] text-[#1a5c4a]" },
                          { field: "medicines", title: "Medicines", icon: Pill, tone: "bg-blue-50 text-blue-800" },
                          { field: "tests", title: "Tests", icon: FlaskConical, tone: "bg-violet-50 text-violet-800" },
                        ].map(({ field, title, icon: Icon, tone }) => {
                          const items = summaryList(ehr.patient_summary[field]);
                          return <div key={field} className={`rounded-xl p-3 ${tone}`}>
                            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><Icon className="h-4 w-4" />{title}</p>
                            {items.length ? <ul className="mt-2 space-y-1 text-sm leading-5">{items.map((item) => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs opacity-70">Not discussed in the conversation.</p>}
                          </div>;
                        })}
                      </div>
                      {typeof ehr.patient_summary.follow_up === "string" && ehr.patient_summary.follow_up ? <div className="mt-3 rounded-xl bg-[#17312d] p-3 text-white"><p className="text-[11px] font-black uppercase tracking-wide text-white/60">Follow-up</p><p className="mt-1 text-sm font-semibold">{ehr.patient_summary.follow_up}</p></div> : null}
                      {summaryList(ehr.patient_summary.warning_signs).length ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-800"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><AlertCircle className="h-4 w-4" />Seek help if</p><ul className="mt-2 space-y-1 text-sm">{summaryList(ehr.patient_summary.warning_signs).map((item) => <li key={item}>• {item}</li>)}</ul></div> : null}
                    </section>

                    <h2 className="mt-6 text-sm font-black text-[#202825]">Full structured EHR</h2>
                    <p className="mt-1 text-xs text-[#60766f]">Clinical fields for the doctor to verify against the conversation above.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {ehrFields.map(([field, label, kind]) => (
                        <label key={field} className={field === "private_doctor_notes" || field === "treatment_plan" ? "md:col-span-2" : ""}>
                          <span className="text-xs font-bold text-[#40514b]">{label}</span>
                          <textarea
                            value={editableValue(ehr.ehr_data[field], kind)}
                            onChange={(event) => updateEhrField("ehr_data", field, kind, event.target.value)}
                            disabled={ehr.status === "approved"}
                            placeholder={kind === "list" || kind === "object" ? "One item per line" : "Not mentioned"}
                            className="mt-1 min-h-[82px] w-full rounded-xl border border-[#d5e3dd] bg-white p-3 text-sm leading-5 text-[#202825] outline-none focus:border-[#68ad94] disabled:bg-[#edf3f0]"
                          />
                        </label>
                      ))}
                    </div>

                    <h2 className="mt-6 text-sm font-black text-[#202825]">Edit patient summary</h2>
                    <p className="mt-1 text-xs text-[#60766f]">Correct the diet, doctor suggestions, medicines and instructions before approval.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {summaryFields.map(([field, label, kind]) => (
                        <label key={field} className={field === "visit_overview" ? "md:col-span-2" : ""}>
                          <span className="text-xs font-bold text-[#40514b]">{label}</span>
                          <textarea
                            value={editableValue(ehr.patient_summary[field], kind)}
                            onChange={(event) => updateEhrField("patient_summary", field, kind, event.target.value)}
                            disabled={ehr.status === "approved"}
                            placeholder={kind === "list" ? "One item per line" : "Not mentioned"}
                            className="mt-1 min-h-[82px] w-full rounded-xl border border-[#d5e3dd] bg-white p-3 text-sm leading-5 text-[#202825] outline-none focus:border-[#68ad94] disabled:bg-[#edf3f0]"
                          />
                        </label>
                      ))}
                    </div>

                    {ehr.status === "draft" ? (
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={saveEhrDraft} disabled={isSavingEhr}><Save className="mr-2 h-4 w-4" /> Save draft</Button>
                        <Button onClick={approveEhr} disabled={isSavingEhr} className="bg-[#1a5c4a] hover:bg-[#144a3c]"><ShieldCheck className="mr-2 h-4 w-4" /> Review complete — approve</Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
