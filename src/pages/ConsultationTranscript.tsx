import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle, Apple, ArrowLeft, Check, FileAudio, FlaskConical, ListChecks,
  Loader2, Pill, RotateCcw, Save, ShieldCheck, Sparkles, Stethoscope, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl, clinicAuthHeaders } from "@/lib/api";
import { clearConsultationRecording, getConsultationRecording } from "@/lib/consultationRecording";
import { medicationMealCode, medicationWhenToTake } from "@/lib/medicationDisplay";
import { EMPTY_ASSESSMENT_MESSAGE, EMPTY_PATIENT_SUMMARY_MESSAGE, EMPTY_PLAN_MESSAGE, hasAssessmentContent, hasPlanContent } from "@/lib/soapPresentation";

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
  patient_summary_preview?: Record<string, unknown>;
  approved_at?: string | null;
};

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
  const sv = data.schema_version;
  return !!(sv === "1.0" || sv === "1.1" || data.subjective || data.visit_details);
}

function hasValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasValue);
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

function EditableChiefComplaintsTable({ value, onChange }: { value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  const update = (index: number, key: string, nextValue: string) => { const next = [...items]; next[index] = { ...next[index], [key]: nextValue }; onChange(next); };
  return <div className="space-y-3"><div className="overflow-hidden rounded-xl border border-[#cbded7] bg-white"><table className="w-full table-fixed border-collapse text-left"><thead><tr className="bg-[#edf7f3] text-[11px] font-black text-[#315b4f]"><th className="w-[62%] px-3 py-2.5">Complaint</th><th className="w-[31%] px-3 py-2.5">Duration</th><th className="w-[7%] px-2 py-2.5"></th></tr></thead><tbody>{items.map((item, i) => <tr key={i} className="border-t border-[#dfeae6] hover:bg-[#fbfdfc]"><td className="px-2 py-1"><input aria-label="Complaint" value={String(item.complaint || "")} onChange={(e) => update(i, "complaint", e.target.value)} placeholder="e.g. Fever" className="w-full border-0 bg-transparent px-1 py-1.5 text-xs font-black text-[#17312d] outline-none focus:ring-0" /></td><td className="border-l border-[#edf2f0] px-2 py-1"><input aria-label="Duration" value={String(item.duration || "")} onChange={(e) => update(i, "duration", e.target.value)} placeholder="e.g. 2 days" className="w-full border-0 bg-transparent px-1 py-1.5 text-xs text-[#40514b] outline-none focus:ring-0" /></td><td className="border-l border-[#edf2f0] px-2 text-center"><button aria-label={`Remove complaint ${i + 1}`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="rounded px-2 text-base text-slate-400 hover:bg-red-50 hover:text-red-600">&times;</button></td></tr>)}</tbody></table>{!items.length ? <p className="border-t border-[#dfeae6] px-4 py-4 text-center text-xs italic text-slate-500">No chief complaint was stated.</p> : null}</div><button onClick={() => onChange([...items, { complaint: "", duration: null }])} className="rounded-lg border border-dashed border-[#8bbdab] px-3 py-1.5 text-xs font-black text-[#1a5c4a] hover:bg-[#edf7f3]">+ Add complaint</button></div>;
}

function EditableCurrentMedicationsTable({ value, onChange }: { value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  const updateName = (index: number, name: string) => { const next = [...items]; next[index] = { ...next[index], name }; onChange(next); };
  return <div className="space-y-3"><div className="overflow-hidden rounded-xl border border-[#cbded7] bg-white"><table className="w-full border-collapse text-left"><thead><tr className="bg-[#edf7f3] text-[11px] font-black text-[#315b4f]"><th className="px-3 py-2.5">Current medicine name</th><th className="w-12 px-2 py-2.5"></th></tr></thead><tbody>{items.map((item, i) => <tr key={i} className="border-t border-[#dfeae6] hover:bg-[#fbfdfc]"><td className="px-3 py-1.5"><input aria-label="Current medicine name" value={String(item.name || "")} onChange={(e) => updateName(i, e.target.value)} placeholder="Medicine name" className="w-full border-0 bg-transparent px-1 py-1.5 text-sm font-black text-[#17312d] outline-none focus:ring-0" /></td><td className="px-2 text-center"><button aria-label={`Remove current medicine ${i + 1}`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="rounded px-2 text-base text-slate-400 hover:bg-red-50 hover:text-red-600">&times;</button></td></tr>)}</tbody></table>{!items.length ? <p className="border-t border-[#dfeae6] px-4 py-4 text-center text-xs italic text-slate-500">No current medicine was stated.</p> : null}</div><button onClick={() => onChange([...items, { name: "", strength: null, dose: null, frequency: null, timing: null, duration: null, source: "patient_reported" }])} className="rounded-lg border border-dashed border-[#8bbdab] px-3 py-1.5 text-xs font-black text-[#1a5c4a] hover:bg-[#edf7f3]">+ Add current medicine</button></div>;
}

function EditablePhysicalExamination({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fields = ["general", "respiratory", "cardiovascular", "ent", "abdomen", "neurological"];
  return <div className="grid gap-3 md:grid-cols-2">{fields.map((field) => <label key={field} className="rounded-xl border border-[#d9e6e1] bg-[#fbfdfc] p-3"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#315b4f]">{fieldLabel(field)}</span><textarea value={String(obj[field] || "")} onChange={(e) => onChange({ ...obj, [field]: e.target.value || null })} placeholder="Leave blank if not examined" rows={2} className="mt-1.5 w-full resize-none rounded-md border border-transparent bg-white px-2.5 py-2 text-sm leading-5 outline-none hover:border-slate-200 focus:border-[#68ad94]" /></label>)}<div className="rounded-xl border border-[#d9e6e1] bg-[#fbfdfc] p-3 md:col-span-2"><label className="text-[10px] font-black uppercase tracking-[0.12em] text-[#315b4f]">Other examination findings</label><div className="mt-1.5"><EditableList value={Array.isArray(obj.other) ? obj.other as string[] : []} onChange={(v) => onChange({ ...obj, other: v })} /></div></div></div>;
}

function EditableDiagnosesTable({ value, onChange }: { value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  return <div className="space-y-2">{items.map((item, i) => <div key={i} className="flex flex-wrap gap-1.5 items-start"><input value={String(item.name || "")} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], name: e.target.value }; onChange(next); }} placeholder="Diagnosis" className="w-36 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /><select value={String(item.status || "provisional")} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], status: e.target.value }; onChange(next); }} className="rounded border border-slate-200 bg-white px-1 py-1 text-xs outline-none"><option value="confirmed">Confirmed</option><option value="provisional">Provisional</option><option value="differential">Differential</option></select><input value={String(item.code || "")} onChange={(e) => { const next = [...items]; next[i] = { ...next[i], code: e.target.value }; onChange(next); }} placeholder="Code" className="w-20 rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /><button onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500">&times;</button></div>)}<button onClick={() => onChange([...items, { name: "", status: "provisional", code: "", source: "clinician_documented" }])} className="mt-1 text-xs font-bold text-[#1a5c4a] hover:underline">+ Add diagnosis</button></div>;
}

function EditablePlanMedicationsTable({ value, onChange }: { value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void }) {
  const items = Array.isArray(value) ? value : [];
  const update = (index: number, key: string, nextValue: unknown) => { const next = [...items]; next[index] = { ...next[index], [key]: nextValue }; onChange(next); };
  const compactField = (index: number, item: Record<string, unknown>, key: string, placeholder: string, strong = false) => <input aria-label={placeholder} value={String(item[key] || "")} onChange={(e) => update(index, key, e.target.value || null)} placeholder={placeholder} className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none hover:border-slate-200 focus:border-[#68ad94] focus:bg-white ${strong ? "font-black text-[#17312d]" : "text-[#40514b]"}`} />;
  const updateWhen = (index: number, value: string) => {
    const schedule: Record<string, string | null> = { morning: null, afternoon: null, night: null };
    if (value === "Breakfast") schedule.morning = "Breakfast";
    if (value === "Lunch") schedule.afternoon = "Lunch";
    if (value === "Dinner") schedule.night = "Dinner";
    const next = [...items];
    next[index] = { ...next[index], specific_timing: value || null, schedule };
    onChange(next);
  };

  return <div className="space-y-3">
    <div className="overflow-x-auto rounded-xl border border-[#cbded7] bg-white">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
        <thead><tr className="bg-[#edf7f3] text-[11px] font-black text-[#315b4f]"><th className="w-[25%] px-3 py-2.5">Medicine</th><th className="w-[20%] px-3 py-2.5">Dosage</th><th className="w-[20%] px-3 py-2.5">When to take</th><th className="w-[15%] px-3 py-2.5">AF / BF</th><th className="w-[20%] px-3 py-2.5">Duration</th></tr></thead>
        <tbody>{items.map((item, i) => {
          const selectedWhen = medicationWhenToTake(item);
          return <tr key={i} className="border-t border-[#dfeae6] align-top hover:bg-[#fbfdfc]">
            <td className="px-2 py-2">
              {compactField(i, item, "medicine_name", "Medicine name", true)}
              <div className="flex justify-end px-1.5 pt-1"><button aria-label={`Remove prescription ${i + 1}`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="rounded px-2 py-0.5 text-base text-slate-400 hover:bg-red-50 hover:text-red-600">&times;</button></div>
            </td>
            <td className="border-l border-[#edf2f0] px-2 py-2">{compactField(i, item, "dose", "1 tablet / 5 ml")}</td>
            <td className="border-l border-[#edf2f0] px-2 py-2"><select aria-label="When to take" value={selectedWhen} onChange={(e) => updateWhen(i, e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-[#315b4f]"><option value="">-</option><option value="Breakfast">Breakfast</option><option value="Lunch">Lunch</option><option value="Dinner">Dinner</option></select></td>
            <td className="border-l border-[#edf2f0] px-3 py-3"><select aria-label="AF or BF" value={medicationMealCode(item)} onChange={(e) => update(i, "meal_timing", e.target.value === "AF" ? "After food" : e.target.value === "BF" ? "Before food" : null)} className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-black text-[#315b4f]"><option value="">-</option><option value="AF">AF</option><option value="BF">BF</option></select></td>
            <td className="border-l border-[#edf2f0] px-2 py-2">{compactField(i, item, "duration", "3 days")}</td>
          </tr>;
        })}</tbody>
      </table>
      {!items.length ? <p className="border-t border-[#dfeae6] px-4 py-5 text-center text-xs italic text-slate-500">No prescription recorded. Add only medicines explicitly discussed.</p> : null}
    </div>
    <button onClick={() => onChange([...items, { medicine_name: "", strength: null, dosage_form: null, dose: null, route: null, frequency: null, schedule: { morning: null, afternoon: null, night: null }, specific_timing: null, meal_timing: null, duration: null, prn_condition: null, indication: null, instructions: null, action: null }])} className="rounded-lg border border-dashed border-[#8bbdab] px-4 py-2 text-xs font-black text-[#1a5c4a] hover:bg-[#edf7f3]">+ Add prescription</button>
  </div>;
}

function renderPatientMedicines(value: unknown): ReactNode {
  if (!Array.isArray(value) || !value.length) return null;
  const medicines = value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  if (!medicines.length) return renderClinicalValue(value);
  return <div className="overflow-x-auto rounded-lg border border-[#d9e8e2]"><table className="w-full min-w-[680px] border-collapse text-left text-xs"><thead><tr className="bg-[#edf7f3] text-[#365c51]"><th className="px-3 py-2 font-black">Medicine</th><th className="px-3 py-2 font-black">Dosage</th><th className="px-3 py-2 font-black">When to take</th><th className="px-3 py-2 font-black">AF / BF</th><th className="px-3 py-2 font-black">Duration</th></tr></thead><tbody>{medicines.map((medicine, index) => { const when = medicationWhenToTake(medicine); const meal = medicationMealCode(medicine); return <tr key={index} className="border-t border-[#e1ece8] bg-white align-top"><td className="px-3 py-2 font-bold text-[#17312d]">{String(medicine.medicine_name || "Medicine")}</td><td className="px-3 py-2 text-[#40514b]">{hasValue(medicine.dose) ? String(medicine.dose) : "—"}</td><td className="px-3 py-2 text-[#40514b]">{when || "—"}</td><td className="px-3 py-2 font-bold text-[#315b4f]">{meal || "—"}</td><td className="px-3 py-2 text-[#40514b]">{hasValue(medicine.duration) ? String(medicine.duration) : "—"}</td></tr>; })}</tbody></table></div>;
}

function renderPatientWarningSigns(value: unknown): ReactNode {
  if (!Array.isArray(value) || !value.length) return null;
  return <div className="space-y-2">{value.map((item, index) => {
    const warning = asRecord(item);
    const exactInstruction = hasValue(warning.raw_instruction)
      ? String(warning.raw_instruction)
      : typeof item === "string"
        ? item
        : [warning.condition, warning.action].filter(hasValue).map(String).join(" — ");
    if (!exactInstruction) return null;
    return <div key={index} className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /><p className="font-semibold leading-5 text-amber-950">{exactInstruction}</p></div>;
  })}</div>;
}

function EditableReferralObject({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={obj.required === true} onChange={(e) => onChange({ ...obj, required: e.target.checked })} className="rounded border-slate-300" /><span className="font-bold">Referral required</span></label>{obj.required === true ? <><input value={String(obj.specialty || "")} onChange={(e) => onChange({ ...obj, specialty: e.target.value })} placeholder="Specialty" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /><textarea value={String(obj.reason || "")} onChange={(e) => onChange({ ...obj, reason: e.target.value })} placeholder="Reason for referral" rows={2} className="mt-1 w-full resize-none rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /></> : null}</div>;
}

function EditableFollowUpObject({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={obj.required === true} onChange={(e) => onChange({ ...obj, required: e.target.checked })} className="rounded border-slate-300" /><span className="font-bold">Follow-up required</span></label>{obj.required === true ? <><input value={String(obj.timeframe || "")} onChange={(e) => onChange({ ...obj, timeframe: e.target.value })} placeholder="Timeframe (e.g. 2 weeks)" className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /><textarea value={String(obj.instructions || "")} onChange={(e) => onChange({ ...obj, instructions: e.target.value })} placeholder="Follow-up instructions" rows={2} className="mt-1 w-full resize-none rounded border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-[#9acdbb]" /></> : null}</div>;
}

function EhrSection({ title, code, children }: { title: string; code?: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-slate-300 bg-white"><div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3">{code ? <span className="grid h-7 w-7 place-items-center rounded-md bg-[#17312d] text-xs font-black text-white">{code}</span> : null}<h3 className="text-sm font-black uppercase tracking-[0.13em] text-[#17312d]">{title}</h3></div><div className="p-5">{children}</div></section>;
}

export default function ConsultationTranscript() {
  const navigate = useNavigate();
  const recording = useMemo(() => getConsultationRecording(), []);
  const [audioUrl, setAudioUrl] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [processingStage, setProcessingStage] = useState<"idle" | "transcribing" | "queued" | "generating" | "complete">("idle");
  const [ehr, setEhr] = useState<EhrEncounter | null>(null);
  const [isSavingEhr, setIsSavingEhr] = useState(false);
  const [ehrNotice, setEhrNotice] = useState("");
  const [error, setError] = useState("");
  const autoProcessingStarted = useRef(false);
  const queuePollingCancelled = useRef(false);

  useEffect(() => {
    queuePollingCancelled.current = false;
    return () => { queuePollingCancelled.current = true; };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const url = URL.createObjectURL(recording.blob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  useEffect(() => {
    if (recording && processingStage === "idle" && !autoProcessingStarted.current) {
      autoProcessingStarted.current = true;
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
        headers: clinicAuthHeaders(),
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
    queuePollingCancelled.current = false;
    try {
      const response = await fetch(apiUrl("/api/ehr/drafts/jobs"), {
        method: "POST",
        headers: clinicAuthHeaders(true),
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
      let job = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(job.detail || "The EHR draft could not be queued.");

      while (!queuePollingCancelled.current) {
        if (job.status === "completed" && job.encounter) {
          setEhr(job.encounter);
          setProcessingStage("complete");
          setEhrNotice("EHR draft generated. Review every field before approval.");
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "The EHR draft could not be generated.");
        }

        if (job.status === "processing") {
          setProcessingStage("generating");
          setEhrNotice("Your EMR is now being generated on the GPU.");
        } else {
          const position = Math.max(1, Number(job.position) || 1);
          const minutes = Math.max(1, Number(job.estimated_wait_minutes) || 5);
          setProcessingStage("queued");
          setEhrNotice(`GPU queue position ${position}. Estimated wait: about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
        }

        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const statusResponse = await fetch(
          apiUrl(`/api/ehr/drafts/jobs/${encodeURIComponent(job.job_id)}?clinic_id=${encodeURIComponent(recording.patient.clinicId)}`),
          { headers: clinicAuthHeaders() },
        );
        job = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(job.detail || "Could not check the EHR generation queue.");
      }
    } catch (requestError) {
      if (queuePollingCancelled.current) return;
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
        headers: clinicAuthHeaders(true),
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
        headers: clinicAuthHeaders(true),
        body: JSON.stringify({ ehr_data: ehr.ehr_data, patient_summary: ehr.patient_summary, actor_id: recording.patient.doctorId }),
      });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saved.detail || "Could not save the reviewed EHR.");
      const response = await fetch(apiUrl(`/api/ehr/encounters/${encodeURIComponent(ehr.encounter_id)}/approve?clinic_id=${encodeURIComponent(recording.patient.clinicId)}`), {
        method: "POST",
        headers: clinicAuthHeaders(true),
        body: JSON.stringify({ approved_by: recording.patient.doctorId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not approve the EHR.");
      clearConsultationRecording();
      navigate("/doctor-dashboard");
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
  const visitDetails = (isSoap ? asRecord(ehr!.ehr_data.visit_details) : {}) as Record<string, unknown>;
  const displayedPatientSummary = ehr
    ? ehr.status === "approved"
      ? ehr.patient_summary
      : {
          ...(ehr.patient_summary_preview || {}),
          // Plan is the single prescription source of truth. Rendering this
          // live array prevents a stale or independently edited draft summary.
          medicines: Array.isArray(plan.prescriptions) ? plan.prescriptions : [],
        }
    : {};

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
      <div className="mx-auto max-w-[1500px]">
        <button type="button" onClick={discardAndReturn} className="inline-flex items-center gap-2 text-sm font-bold text-[#1a5c4a]">
          <ArrowLeft className="h-4 w-4" /> Doctor dashboard
        </button>

        <div className="mt-5 overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_-50px_rgba(18,64,54,0.7)]">
          <header className="border-b border-[#e5ded4] px-5 py-5 md:px-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-[#202825] md:text-3xl">Consultation EHR Review</h1>
                <p className="mt-1 text-sm text-[#68736f]">{recording.patient.name}{recording.patient.token ? ` · ${recording.patient.token}` : ""} · {formatTime(recording.durationSeconds)}</p>
              </div>
              {ehr ? <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-amber-800">{ehr.status}</span> : null}
            </div>
          </header>

          <div className="space-y-5 p-5 md:p-8">
            <aside className="flex flex-col gap-3 rounded-2xl border border-[#d9e4df] bg-[#f8fbf9] p-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="shrink-0"><p className="text-xs font-black uppercase tracking-wide text-[#365c51]">Consultation audio</p><p className="mt-0.5 text-xs text-[#6d7c77]">{formatTime(recording.durationSeconds)}</p></div>
                {audioUrl && <audio className="h-10 w-full max-w-xl" controls src={audioUrl} />}
              </div>

              {processingStage === "transcribing" || processingStage === "queued" || processingStage === "generating" ? (
                <div className="flex items-center gap-2 rounded-xl border border-[#e0e7e3] bg-white px-4 py-2.5">
                  <Loader2 className="h-5 w-5 animate-spin text-[#1a5c4a]" />
                  <p className="text-sm font-bold text-[#202825]">
                    {processingStage === "transcribing" ? "Transcribing consultation..." : "Building EHR draft..."}
                  </p>
                </div>
              ) : processingStage === "idle" && !ehr ? (
                <Button onClick={transcribe} className="bg-[#1a5c4a] hover:bg-[#144a3c]"><Sparkles className="mr-2 h-4 w-4" /> Start processing</Button>
              ) : null}

              <button type="button" onClick={discardAndReturn} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d9d2c8] bg-white px-3 py-2.5 text-xs font-bold text-[#58645f]">
                <RotateCcw className="h-4 w-4" /> Discard and record again
              </button>
            </aside>

            <section className="min-w-0">
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
                      {processingStage === "transcribing" ? "Processing consultation audio..." : processingStage === "queued" ? "Waiting for the EMR GPU..." : "Preparing EHR draft..."}
                    </p>
                    <p className="mt-1 text-sm text-[#68736f]">{ehrNotice || "Your consultation record is being prepared."}</p>
                  </div>
                </div>
              ) : processingStage === "idle" && !ehr ? (
                <div className="grid min-h-[360px] place-items-center rounded-2xl border-2 border-dashed border-[#d8d1c7] bg-[#fbfaf7] p-8 text-center">
                  <div><FileAudio className="mx-auto h-12 w-12 text-[#8ba69d]" /><p className="mt-4 font-bold text-[#202825]">Ready to process consultation</p><p className="mt-2 max-w-md text-sm leading-6 text-[#68736f]">Recording captured. Processing will begin automatically.</p></div>
                </div>
              ) : ehr ? (
                <div>
                  {ehrNotice ? <p className="mb-4 rounded-xl bg-[#edf8f3] p-3 text-xs font-bold text-[#1a5c4a]">{ehrNotice}</p> : null}

                  {isSoap ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-lg">
                      <header className="border-b-4 border-[#1a5c4a] bg-[#17312d] px-5 py-5 text-white sm:px-8">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2"><Stethoscope className="h-6 w-6 text-[#9de1ca]" /><h2 className="text-xl font-black tracking-tight">{String(visitDetails.clinic_name || "Clinic")}</h2></div>
                            <p className="mt-1 text-xs text-white/70">{visitDetails.doctor_name ? `Dr. ${String(visitDetails.doctor_name).replace(/^Dr\.?\s*/i, "")}` : "Doctor review"}</p>
                          </div>
                          <div className="sm:text-right">
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#9de1ca]">Electronic Health Record</p>
                            <p className="mt-1 font-mono text-xs text-white/75">{ehr.encounter_id}</p>
                            <span className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase bg-amber-300 text-amber-950">DRAFT</span>
                          </div>
                        </div>
                      </header>

                      <div className="space-y-6 px-5 py-5 sm:px-8">
                        <section className="grid gap-0 overflow-hidden rounded-xl border border-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="border-b border-slate-300 bg-slate-50 p-4 sm:border-r xl:border-b-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Patient</p>
                            <p className="mt-2 text-lg font-black">{recording.patient.name}</p>
                            <p className="mt-1 text-xs text-slate-600">{recording.patient.phone || ""}</p>
                          </div>
                          <div className="border-b border-slate-300 p-4 xl:border-b-0 xl:border-r">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Doctor</p>
                            <p className="mt-2 text-sm font-black">{visitDetails.doctor_name ? `Dr. ${String(visitDetails.doctor_name).replace(/^Dr\.?\s*/i, "")}` : "—"}</p>
                          </div>
                          <div className="border-b border-slate-300 bg-slate-50 p-4 sm:border-r xl:border-b-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Clinic</p>
                            <p className="mt-2 text-sm font-black">{String(visitDetails.clinic_name || "—")}</p>
                            {hasValue(visitDetails.clinic_address) ? <p className="mt-1 text-xs leading-5 text-slate-600">{String(visitDetails.clinic_address)}</p> : null}
                            {hasValue(visitDetails.clinic_phone) ? <p className="mt-1 text-xs font-semibold text-slate-700">{String(visitDetails.clinic_phone)}</p> : null}
                          </div>
                          <div className="p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[#58716a]">Visit</p>
                            <p className="mt-2 text-sm font-black">{recording.patient.token ? `Token: ${recording.patient.token}` : "Walk-in"}</p>
                            <p className="mt-1 text-xs text-slate-600">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                          </div>
                        </section>

                        {hasValue(subjective.chief_complaints) || hasValue(subjective.history_of_present_illness) || hasValue(subjective.relevant_negatives) || hasValue(subjective.medical_conditions) || hasValue(subjective.allergies) || hasValue(subjective.current_medications) || hasValue(subjective.family_history) || hasValue(subjective.social_history) ? (
                          <EhrSection code="S" title="Subjective — Patient history">
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {(["chief_complaints", "history_of_present_illness", "relevant_negatives", "medical_conditions", "allergies", "current_medications", "family_history", "social_history"] as const).map((field) => {
                                const val = subjective[field];
                                if (field === "chief_complaints") {
                                  return <div key={field} className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Chief complaints</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableChiefComplaintsTable value={val as Record<string, unknown>[]} onChange={(v) => setSoapField("subjective.chief_complaints", v)} /> : <textarea value="" onChange={() => {}} placeholder="Not mentioned" className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm italic text-slate-400 outline-none focus:ring-0" />}</dd></div></div>;
                                }
                                if (field === "current_medications") {
                                  return <div key={field} className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Current medications</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableCurrentMedicationsTable value={val as Record<string, unknown>[]} onChange={(v) => setSoapField("subjective.current_medications", v)} /> : <EditableList value={Array.isArray(val) ? val as string[] : []} onChange={(v) => setSoapField("subjective.current_medications", v)} />}</dd></div></div>;
                                }
                                if (field === "allergies") {
                                  return <div key={field} className="sm:col-span-2"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><dt className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800"><AlertCircle className="h-4 w-4" /> Allergies</dt><dd className="mt-2"><EditableList value={Array.isArray(val) ? val as string[] : []} onChange={(v) => setSoapField("subjective.allergies", v)} /></dd><p className="mt-2 text-[10px] text-amber-800">Includes only allergies or allergy denials explicitly stated by the patient or caregiver.</p></div></div>;
                                }
                                if (field === "relevant_negatives") {
                                  return <div key={field} className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Relevant negatives</dt><dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val as string[]} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : <textarea value="" onChange={() => {}} placeholder="No negatives recorded" className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm italic text-slate-400 outline-none focus:ring-0" />}</dd></div></div>;
                                }
                                return hasValue(val) || field === "allergies" || field === "medical_conditions" || field === "family_history" || field === "social_history" ? (
                                  <div key={field} className={field === "history_of_present_illness" ? "sm:col-span-2" : ""}>
                                    <div className="border-b border-slate-200 pb-3">
                                      <dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{fieldLabel(field)}</dt>
                                      <dd className="mt-1.5">{Array.isArray(val) ? <EditableList value={val as string[]} onChange={(v) => setSoapField(`subjective.${field}`, v)} /> : <EditableText value={typeof val === "string" ? val : ""} onChange={(v) => setSoapField(`subjective.${field}`, v)} />}</dd>
                                    </div>
                                  </div>
                                ) : null;
                              })}
                            </div>
                          </EhrSection>
                        ) : null}

                        {hasValue(objective.vitals) || hasObjectContent(objective.physical_examination) || hasValue(objective.investigations) ? (
                          <EhrSection code="O" title="Objective — Clinical findings">
                            <div className="space-y-3">
                              {hasValue(objective.vitals) ? <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Vitals and measurements</dt><dd className="mt-1.5">{renderVitalsGrid(objective.vitals)}</dd></div> : null}
                              {hasObjectContent(objective.physical_examination) ? <div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Physical examination</dt><dd className="mt-1.5"><EditablePhysicalExamination value={objective.physical_examination as Record<string, unknown>} onChange={(v) => setSoapField("objective.physical_examination", v)} /></dd></div> : null}
                              {hasValue(objective.investigations) ? <div><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Investigations</dt><dd className="mt-1.5"><EditableList value={objective.investigations as string[]} onChange={(v) => setSoapField("objective.investigations", v)} /></dd></div> : null}
                            </div>
                          </EhrSection>
                        ) : null}

                        <EhrSection code="A" title="Assessment — Clinical opinion">
                          {!hasAssessmentContent(assessment) ? <p className="mb-3 text-sm italic text-slate-500">{EMPTY_ASSESSMENT_MESSAGE}</p> : null}
                          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                            <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Clinical impression</dt><dd className="mt-1.5"><EditableText value={typeof assessment.clinical_impression === "string" ? assessment.clinical_impression : ""} onChange={(v) => setSoapField("assessment.clinical_impression", v)} placeholder="Doctor may add an assessment" /></dd></div></div>
                            {[["provisional_diagnosis", "Provisional diagnosis"], ["confirmed_diagnosis", "Confirmed diagnosis"], ["differential_diagnoses", "Differential diagnoses"], ["problems_being_managed", "Problems being managed"]].map(([field, label]) => <div key={field}><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{label}</dt><dd className="mt-1.5"><EditableList value={Array.isArray(assessment[field]) ? assessment[field] as string[] : []} onChange={(v) => setSoapField(`assessment.${field}`, v)} /></dd></div></div>)}
                          </div>
                        </EhrSection>

                        <EhrSection code="P" title="Plan — Treatment and follow-up">
                          {!hasPlanContent(plan) ? <p className="mb-3 text-sm italic text-slate-500">{EMPTY_PLAN_MESSAGE}</p> : null}
                          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                            <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Prescriptions</dt><dd className="mt-1.5"><EditablePlanMedicationsTable value={Array.isArray(plan.prescriptions) ? plan.prescriptions as Record<string, unknown>[] : []} onChange={(v) => setSoapField("plan.prescriptions", v)} /></dd></div></div>
                            {[["tests_ordered", "Tests ordered"], ["procedures", "Procedures"], ["treatment_advice", "Treatment advice"], ["diet_lifestyle_advice", "Diet & lifestyle advice"], ["monitoring", "Monitoring"], ["referrals", "Referrals"], ["warning_signs", "Warning signs"], ["other_instructions", "Other instructions"]].map(([field, label]) => <div key={field} className={field === "warning_signs" || field === "other_instructions" ? "sm:col-span-2" : ""}><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">{label}</dt><dd className="mt-1.5"><EditableList value={Array.isArray(plan[field]) ? plan[field] as string[] : []} onChange={(v) => setSoapField(`plan.${field}`, v)} /></dd></div></div>)}
                            <div className="sm:col-span-2"><div className="border-b border-slate-200 pb-3"><dt className="text-[10px] font-black uppercase tracking-[0.12em] text-[#58716a]">Follow-up</dt><dd className="mt-1.5"><EditableText value={typeof plan.follow_up === "string" ? plan.follow_up : ""} onChange={(v) => setSoapField("plan.follow_up", v)} placeholder="Doctor may add follow-up instructions" /></dd></div></div>
                          </div>
                        </EhrSection>

                        <footer className="rounded-lg border border-[#b9ddcf] bg-[#f4fbf8] p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#1a5c4a]"><ShieldCheck className="h-4 w-4" /> Clinical approval</p>
                              <p className="mt-1 text-sm font-bold text-amber-700">DRAFT — Awaiting doctor review and approval</p>
                              <p className="mt-0.5 text-xs text-slate-600">This is not a signed final medical record</p>
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
                          <p className="mt-1 text-xs text-[#60766f]">Review every field before approval.</p>
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
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-black text-[#17312d]">Patient Summary{ehr.status === "draft" ? " Preview" : ""}</p>{ehr.status === "draft" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">Draft</span> : null}</div>
                      <p className="mt-1 text-xs text-[#60766f]">{ehr.status === "draft" ? "Generated from the current SOAP draft for doctor review. The patient receives the final version only after approval." : "A simple version of the doctor-approved SOAP record for the patient."}</p>
                    </div>
                    <div className="p-4">
                      {!hasValue(displayedPatientSummary) ? <p className="rounded-xl bg-white p-4 text-sm text-[#40514b]">{EMPTY_PATIENT_SUMMARY_MESSAGE}</p> : <div className="grid gap-3 md:grid-cols-2">{[["visit_summary", "Visit Summary"], ["medicines", "Medicines"], ["tests", "Tests"], ["procedures", "Procedures"], ["diet_and_care", "Diet & Care"], ["monitoring", "Monitoring"], ["referrals", "Referrals"], ["other_instructions", "Other Doctor Instructions"], ["when_to_seek_help", "Warning Signs — When to Seek Help"], ["follow_up", "Follow-Up"]].map(([field, title]) => { const value = displayedPatientSummary[field]; if (!hasValue(value)) return null; return <section key={field} className={`rounded-xl bg-white p-3 ${field === "medicines" || field === "other_instructions" || field === "when_to_seek_help" || field === "follow_up" ? "md:col-span-2" : ""}`}><p className="text-xs font-black uppercase tracking-wide text-[#1a5c4a]">{title}</p><div className="mt-2 text-sm leading-6 text-[#30443e]">{field === "medicines" ? renderPatientMedicines(value) : field === "when_to_seek_help" ? renderPatientWarningSigns(value) : renderClinicalValue(value)}</div></section>; })}</div>}
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

function visibleTextRows(value: string, charactersPerLine = 105): number {
  if (!value) return 2;
  return Math.max(2, value.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0));
}

function EditableText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <textarea
    value={value || ""}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder || "Not mentioned"}
    className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm leading-6 text-slate-800 outline-none focus:ring-0 focus:bg-white focus:border focus:border-[#9acdbb] focus:px-2 focus:py-1"
    rows={visibleTextRows(value || "")}
  />;
}

function EditableList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const text = Array.isArray(value) ? value.join("\n") : "";
  return <textarea
    value={text}
    onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
    placeholder="One item per line"
    className="w-full resize-none rounded border-0 bg-transparent p-0 text-sm leading-6 text-slate-800 outline-none focus:ring-0 focus:bg-white focus:border focus:border-[#9acdbb] focus:px-2 focus:py-1"
    rows={visibleTextRows(text)}
  />;
}
