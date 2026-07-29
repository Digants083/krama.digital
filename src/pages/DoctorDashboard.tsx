import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRightCircle, CalendarDays, CheckCircle2, Clock, FileText, Languages, Megaphone, Mic, RefreshCw, Sparkles, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueue } from "@/context/QueueContext";
import { apiUrl } from "@/lib/api";
import { formatDelayedStartTime, formatDelayLabel } from "@/lib/timeFormat";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { ConsultationPatient, saveConsultationRecording } from "@/lib/consultationRecording";

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function dateInputValue(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function addDaysInputValue(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

const reminderQuickOptions = [
  { label: "7d", days: 7 },
  { label: "15d", days: 15 },
  { label: "1m", days: 30 },
  { label: "3m", days: 90 },
  { label: "6m", days: 180 },
  { label: "1yr", days: 365 },
];

function sourceLabel(source?: string) {
  if (source === "walkin") return "Walk-in";
  if (source === "desk") return "Desk";
  if (source === "skipped") return "Skipped";
  return "Online";
}

const SourceBadge = memo(function SourceBadge({ source }: { source?: string }) {
  const isWalkin = source === "walkin";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isWalkin ? "bg-[#FFC107]/25 text-[#7a5800]" : "bg-[#e1f5ee] text-[#0f6e56]"}`}>
      {sourceLabel(source)}
    </span>
  );
});

interface PreviousVisit {
  id: number;
  date: string;
}

interface PatientHistory {
  is_returning: boolean;
  visit_count: number;
  last_visit: string | null;
  previous_visits?: PreviousVisit[];
}

interface RevisitReminder {
  id: number;
  patient_name: string;
  patient_phone?: string;
  token?: string;
  reminder_days?: number;
  revisit_date: string;
  status: string;
  created_at?: string;
}

interface DoctorSessionSlot {
  session_id: number;
  slot_id: number;
  session_name: string;
  time_range: number[];
  time_label: string;
  status: "Available" | "Ongoing" | "Expired" | "Delayed" | "Closed" | string;
  queue_count: number;
  waiting_count: number;
  completed_count: number;
  delay_minutes: number;
  delay_started_at?: string | null;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  is_delay_active?: boolean;
  is_active: boolean;
  is_open?: boolean;
}

interface SessionsResponse {
  sessions: DoctorSessionSlot[];
  active_session_id: number | null;
}

interface DoctorOption {
  doctor_id: string;
  name: string;
  specialization?: string;
}

interface QueueDisplayState {
  sessionId: number;
  queue: Array<{
    token: string;
    name: string;
    phone?: string;
    patient_id?: string;
    patient_email?: string;
    blood_group?: string;
    doctor_delay?: string | null;
    estimated_wait_minutes?: number | null;
    latest_estimated_wait_minutes?: number | null;
    earliest_eta?: string | null;
    predicted_eta?: string | null;
    latest_eta?: string | null;
    rolling_average_minutes?: number | null;
    consultation_window?: string | null;
    estimated_window_text?: string | null;
    active_delay_minutes?: number | null;
    queue_adjusted_time?: string | null;
    session_status?: string | null;
    source: "online" | "desk" | "walkin" | "skipped";
    clinic_id: string;
    appointment_id?: number;
    queue_position?: number;
    slot_id?: number;
  }>;
  currentServing: {
    patientName: string;
    token: string;
    position: number;
    startTime: Date | null;
    phone?: string;
    patient_id?: string;
    patient_email?: string;
    blood_group?: string;
    doctor_delay?: string | null;
    estimated_wait_minutes?: number | null;
    latest_estimated_wait_minutes?: number | null;
    earliest_eta?: string | null;
    predicted_eta?: string | null;
    latest_eta?: string | null;
    rolling_average_minutes?: number | null;
    consultation_window?: string | null;
    estimated_window_text?: string | null;
    active_delay_minutes?: number | null;
    queue_adjusted_time?: string | null;
    session_status?: string | null;
    appointmentId?: number;
    clinicId?: string;
    source?: "online" | "desk" | "walkin" | "skipped";
  } | null;
  completedCount: number;
  skippedCount: number;
  totalToday: number;
  viewingSlotId: number | null;
}

const emptySessionDisplayState = (sessionId: number): QueueDisplayState => ({
  sessionId,
  queue: [],
  currentServing: null,
  completedCount: 0,
  skippedCount: 0,
  totalToday: 0,
  viewingSlotId: sessionId,
});

function formatVisitDate(date?: string | null) {
  if (!date) return "N/A";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed).replace(/,/g, "");
}

function VisitHistoryBadge({ isReturning }: { isReturning: boolean }) {
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-bold ${isReturning ? "bg-[#dff7e8] text-[#14633f]" : "bg-[#dbeafe] text-[#1d4ed8]"}`}>
      {isReturning ? "Returning Patient" : "New Patient"}
    </span>
  );
}

function VisitHistoryDetails({ history, onViewEhr }: { history: PatientHistory; onViewEhr?: (visitId: number, visitDate: string) => void }) {
  const allVisits = history.previous_visits || [];
  const previousVisits = allVisits
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);
  if (!previousVisits.length) return null;

  return (
    <div className="mt-4 rounded-2xl bg-white/45 px-3 py-3 text-left">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[#77756f]">Previous Visits</p>
      <div className="space-y-2">
        {previousVisits.map((visit) => (
          <div key={visit.id} className="flex items-center justify-between border-t border-[#e6ded3] pt-2 first:border-t-0 first:pt-0">
            <p className="text-xs font-semibold text-[#58645f]">{formatVisitDate(visit.date)}</p>
            {onViewEhr && (
              <button
                type="button"
                onClick={() => onViewEhr(visit.id, visit.date)}
                className="flex items-center gap-1 rounded-full bg-[#1a5c4a] px-2.5 py-1 text-[10px] font-bold text-white hover:bg-[#144d3e]"
              >
                <FileText className="h-3 w-3" /> View EHR
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const VisitHistorySidebarCard = memo(function VisitHistorySidebarCard({ history, isLoading, error, onViewEhr }: { history: PatientHistory | null; isLoading: boolean; error: string | null; onViewEhr?: (visitId: number, visitDate: string) => void }) {
  const isReturning = Boolean(history?.is_returning);

  return (
    <div className="rounded-xl bg-[#f6f1e8] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[#77756f]">Visit History</p>
        {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#77756f]" />}
      </div>
      {isLoading ? (
        <p className="text-sm font-semibold text-[#40514b]">Checking clinic history...</p>
      ) : error ? (
        <p className="text-sm font-semibold text-[#40514b]">History unavailable</p>
      ) : history ? (
        <div>
          <VisitHistoryBadge isReturning={isReturning} />
          {isReturning ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-bold text-[#202825]">Previous visit to this clinic</p>
            </div>
          ) : (
            <p className="mt-3 text-sm font-bold text-[#202825]">First visit to this clinic</p>
          )}
          <VisitHistoryDetails history={history} onViewEhr={onViewEhr} />
        </div>
      ) : (
        <div>
          <VisitHistoryBadge isReturning={false} />
          <p className="mt-3 text-sm font-bold text-[#202825]">First visit to this clinic</p>
        </div>
      )}
    </div>
  );
});





function VoiceAssistantCard({ enabled = true, patient }: { enabled?: boolean; patient?: ConsultationPatient }) {
  const navigate = useNavigate();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState("");

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const startRecording = async () => {
    if (!enabled || !patient) return;
    setRecordingError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("Audio recording is not supported in this browser. Use Chrome or Edge over HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => {
        setRecordingError("The recording stopped unexpectedly. Please try again.");
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsRecording(false);
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsRecording(false);
        if (!blob.size) {
          setRecordingError("No audio was captured. Check the microphone and try again.");
          return;
        }
        saveConsultationRecording({ blob, durationSeconds, patient, recordedAt: new Date().toISOString() });
        navigate("/doctor-dashboard/consultation-transcript");
      };
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      setRecordingError(error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access and try again." : "Karma could not open the microphone. Please try again.");
    }
  };

  const stopRecording = () => {
    try {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      } else {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsRecording(false);
      }
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsRecording(false);
    }
  };

  return (
    <div className="rounded-2xl bg-[#17312d] p-3 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Voice Assistant</p>
          <p className="text-[11px] text-white/55">Sarvam voice-to-text · Doctor + patient</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isRecording ? "bg-red-400/20 text-red-200" : "bg-white/10 text-white/70"}`}>{isRecording ? formatElapsed(elapsedSeconds) : "Ready"}</span>
      </div>

      <div className="mt-4 flex justify-center">
        <span className={`grid h-20 w-20 place-items-center rounded-full border-4 ${isRecording ? "border-red-300/35 bg-red-400 text-[#421b1b]" : "border-white/10 bg-white/10 text-[#9de1ca]"}`}>
          <Mic className={`h-9 w-9 ${isRecording ? "animate-pulse" : ""}`} />
        </span>
      </div>

      <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
        <Languages className="h-3.5 w-3.5 shrink-0 text-[#9de1ca]" />
        <p className="truncate text-[11px] font-semibold text-white/65">Hindi · Kannada · Tamil · English</p>
      </div>

      {isRecording ? (
        <div className="mt-3 rounded-xl bg-white/10 p-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <p className="text-xs font-bold">Consultation recording</p>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-white/55">Doctor and patient audio is being captured. Stop when the consultation is complete.</p>
        </div>
      ) : null}

      {recordingError ? <p className="mt-3 rounded-xl bg-red-400/15 p-2.5 text-[11px] leading-4 text-red-100">{recordingError}</p> : null}

      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={!enabled}
        className={`mt-3 w-full rounded-xl px-3 py-2.5 text-xs font-black transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45 ${isRecording ? "bg-red-400 text-[#421b1b]" : "bg-[#9de1ca] text-[#17312d]"}`}
      >
        {!enabled ? "Select patient to begin" : isRecording ? "Stop and generate SOAP EHR" : "Start consultation recording"}
      </button>
    </div>
  );
}

const PatientAiPanel = memo(function PatientAiPanel({ history, isLoading, error, patient }: { history: PatientHistory | null; isLoading: boolean; error: string | null; patient: ConsultationPatient }) {
  return (
    <div className="grid gap-3">
      <VoiceAssistantCard patient={patient} />
    </div>
  );
});

const EmptyPatientAiPanel = memo(function EmptyPatientAiPanel() {
  return (
    <div className="mt-4 grid gap-3 text-left">
      <VoiceAssistantCard patient={{ name: "Voice transcription test" }} />
    </div>
  );
});

function SessionStatusBadge({ status }: { status: string }) {
  const palette = status === "Expired"
    ? "bg-[#fee2e2] text-[#b91c1c]"
    : status === "Delayed"
      ? "bg-[#ffedd5] text-[#c2410c]"
      : status === "Closed"
        ? "bg-[#e5e7eb] text-[#4b5563]"
        : "bg-[#dcfce7] text-[#166534]";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${palette}`}>{status}</span>;
}

const SessionCard = memo(function SessionCard({ session, selected, onSelect }: { session: DoctorSessionSlot; selected: boolean; onSelect: (sessionId: number) => void }) {
  const delayLabel = formatDelayLabel(session.delay_minutes);
  const originalStartTime = session.delay_original_start_time || (delayLabel ? formatDelayedStartTime(session.time_range, 0) : "");
  const updatedStartTime = session.delay_updated_start_time || (delayLabel ? formatDelayedStartTime(session.time_range, session.delay_minutes) : "");
  return (
    <button
      type="button"
      onClick={() => onSelect(session.session_id)}
      className={`min-w-0 rounded-xl border p-3 text-left transition hover:shadow-sm ${selected ? "border-[#1a5c4a] bg-[#e9f7f2]" : "border-[#e6ded3] bg-white/85 hover:border-[#b7d7c8]"}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-[#202825] sm:text-sm">{session.session_name.replace("Time ", "Session ")}</p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-[#58645f]">
            {delayLabel && originalStartTime && updatedStartTime ? (
              <>
                <span className="text-orange-700 line-through decoration-red-500/70 decoration-2">{originalStartTime}</span>
                <span className="px-1 text-orange-700">-&gt;</span>
                <span className="text-orange-700">{updatedStartTime}</span>
              </>
            ) : session.time_label}
          </p>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="rounded-2xl bg-[#f6f1e8] px-2 py-1.5">
          <p className="text-[#77756f]">Patients</p>
          <p className="mt-0.5 font-bold text-[#202825]">{session.queue_count}</p>
        </div>
        <div className="rounded-2xl bg-[#f6f1e8] px-2 py-1.5">
          <p className="text-[#77756f]">Completed</p>
          <p className="mt-0.5 font-bold text-[#202825]">{session.completed_count}</p>
        </div>
      </div>
    </button>
  );
});

const delayOptions = [
  { label: "10 min", value: "10 min" },
  { label: "15 min", value: "15 min" },
  { label: "30 min", value: "30 min" },
  { label: "45 min", value: "45 min" },
  { label: "1 hour", value: "1 hour" },
];

const parseDelayMinutes = (value: string) => {
  const amount = Number.parseInt(value.replace(/[^\d]/g, ""), 10) || 0;
  return value.toLowerCase().includes("hour") ? amount * 60 : amount;
};

const SwitchingOverlay = memo(function SwitchingOverlay({ show }: { show: boolean }) {
  return (
    <div className={`pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-white/45 backdrop-blur-[1px] transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#d8d1c6] bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#40514b] shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Switching session...
      </div>
    </div>
  );
});

export default function KramaDoctorDashboard() {
  const navigate = useNavigate();
  const {
    queue,
    currentServing,
    completedCount,
    skippedCount,
    fetchQueueForClinic,
    viewingSlotId,
  } = useQueue();

  const [clinicId, setClinicId] = useState("");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [hasChosenDoctor, setHasChosenDoctor] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [isSendingDelay, setIsSendingDelay] = useState(false);
  const [selectedDelay, setSelectedDelay] = useState("15 min");
  const [delayNotice, setDelayNotice] = useState<string | null>(null);
  const [isDelayOpen, setIsDelayOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [patientHistory, setPatientHistory] = useState<PatientHistory | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [latestReminder, setLatestReminder] = useState<RevisitReminder | null>(null);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  const [reminderDays, setReminderDays] = useState("30");
  const [revisitDate, setRevisitDate] = useState(() => addDaysInputValue(30));
  const [isSavingReminder, setIsSavingReminder] = useState(false);
  const [sessions, setSessions] = useState<DoctorSessionSlot[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [queueAction, setQueueAction] = useState<"next" | null>(null);
  const [displayQueueState, setDisplayQueueState] = useState<QueueDisplayState | null>(null);
  const [isSessionSwitching, setIsSessionSwitching] = useState(false);
  const queueRequestRef = useRef(0);
  const queueCacheRef = useRef<Record<number, QueueDisplayState>>({});
  const sessionsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const storedClinicId = localStorage.getItem("clinic_id") || "";
    setClinicId(storedClinicId);
  }, []);

  const fetchDoctors = useCallback(async (clinic: string) => {
    if (!clinic) return;
    try {
      const response = await fetch(apiUrl(`/api/auth/clinic/doctors?clinic_id=${encodeURIComponent(clinic)}`));
      if (!response.ok) return;
      const data = await response.json();
      const nextDoctors = data.doctors || [];
      setDoctors(nextDoctors);
    } catch {
      setDoctors([]);
    }
  }, []);

  const fetchTodaySessions = useCallback(async (clinic: string, keepSelection = true, showLoading = true, doctorId?: string) => {
    if (!clinic) return;

    sessionsAbortRef.current?.abort();
    const controller = new AbortController();
    sessionsAbortRef.current = controller;

    try {
      if (showLoading) setSessionsLoading(true);
      setSessionsError(null);
      const suffix = doctorId ? `?doctor_id=${encodeURIComponent(doctorId)}` : "";
      const response = await fetch(apiUrl(`/api/sessions/today/${encodeURIComponent(clinic)}${suffix}`), { signal: controller.signal });
      if (!response.ok) throw new Error("Failed to load sessions");
      const data: SessionsResponse = await response.json();
      const nextSessions = data.sessions || [];
      setSessions(nextSessions);
      setSelectedSessionId((current) => {
        if (keepSelection && current && nextSessions.some((session) => session.session_id === current)) return current;
        return data.active_session_id || nextSessions[0]?.session_id || null;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSessionsError(error instanceof Error ? error.message : "Failed to load sessions");
    } finally {
      if (!controller.signal.aborted && showLoading) setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clinicId) {
      fetchDoctors(clinicId);
    }
  }, [clinicId, fetchDoctors]);

  useEffect(() => {
    if (clinicId && hasChosenDoctor && selectedDoctorId) {
      fetchTodaySessions(clinicId, false, true, selectedDoctorId);
    }
  }, [clinicId, hasChosenDoctor, selectedDoctorId, fetchTodaySessions]);

  const activeSessionId = selectedSessionId ?? viewingSlotId ?? sessions.find((session) => session.is_active)?.session_id ?? sessions[0]?.session_id ?? null;
  const activeSession = sessions.find((session) => session.session_id === activeSessionId) || null;
  const activeOriginalStartTime = activeSession?.delay_original_start_time || (activeSession?.delay_minutes ? formatDelayedStartTime(activeSession.time_range, 0) : "");
  const activeUpdatedStartTime = activeSession?.delay_updated_start_time || (activeSession?.delay_minutes ? formatDelayedStartTime(activeSession.time_range, activeSession.delay_minutes) : "");

  const loadSessionQueue = useCallback(async (sessionId: number, showOverlay = true) => {
    if (!clinicId) return;

    const requestId = ++queueRequestRef.current;
    if (showOverlay) setIsSessionSwitching(true);

    try {
      const snapshot = await fetchQueueForClinic(clinicId, sessionId, undefined, selectedDoctorId || undefined);
      if (requestId !== queueRequestRef.current) return;

      if (snapshot) {
        if (snapshot.viewingSlotId !== sessionId) return;

        const nextDisplayState: QueueDisplayState = {
          sessionId,
          queue: snapshot.queue,
          currentServing: snapshot.currentServing,
          completedCount: snapshot.completedCount,
          skippedCount: snapshot.skippedCount,
          totalToday: snapshot.totalToday,
          viewingSlotId: snapshot.viewingSlotId,
        };
        queueCacheRef.current = { ...queueCacheRef.current, [sessionId]: nextDisplayState };
        setDisplayQueueState(nextDisplayState);
      }
    } catch (error) {
      if (requestId === queueRequestRef.current) {
        setMessage({ text: "Could not switch session. Showing the last queue view.", type: "error" });
      }
    } finally {
      if (showOverlay && requestId === queueRequestRef.current) {
        setIsSessionSwitching(false);
      }
    }
  }, [clinicId, fetchQueueForClinic, selectedDoctorId]);

  useEffect(() => {
    if (!isSessionSwitching) return;
    const failsafe = window.setTimeout(() => setIsSessionSwitching(false), 3500);
    return () => window.clearTimeout(failsafe);
  }, [isSessionSwitching]);

  useEffect(() => {
    if (!clinicId || activeSessionId == null) return;

    const cachedQueue = queueCacheRef.current[activeSessionId];
    if (cachedQueue) {
      setDisplayQueueState(cachedQueue);
    }

    loadSessionQueue(activeSessionId, true);
  }, [clinicId, activeSessionId, loadSessionQueue]);
  useEffect(() => {
    if (activeSessionId == null || isSessionSwitching) return;
    if (viewingSlotId !== activeSessionId) return;

    const nextDisplayState: QueueDisplayState = {
      sessionId: activeSessionId,
      queue,
      currentServing,
      completedCount,
      skippedCount,
      totalToday: completedCount + queue.length + (currentServing ? 1 : 0),
      viewingSlotId,
    };
    queueCacheRef.current = { ...queueCacheRef.current, [activeSessionId]: nextDisplayState };
    setDisplayQueueState(nextDisplayState);
  }, [activeSessionId, completedCount, currentServing, isSessionSwitching, queue, skippedCount, viewingSlotId]);

  useEffect(() => {
    if (!clinicId || !hasChosenDoctor || !selectedDoctorId) return;

    const interval = window.setInterval(() => {
      fetchTodaySessions(clinicId, true, false, selectedDoctorId);
      if (activeSessionId != null) {
        loadSessionQueue(activeSessionId, false);
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [clinicId, activeSessionId, fetchTodaySessions, hasChosenDoctor, loadSessionQueue, selectedDoctorId]);

  useQueueRealtime(clinicId, useCallback(() => {
    if (!clinicId || !hasChosenDoctor || !selectedDoctorId) return;
    fetchTodaySessions(clinicId, true, false, selectedDoctorId);
    if (activeSessionId != null) {
      loadSessionQueue(activeSessionId, false);
    }
  }, [activeSessionId, clinicId, fetchTodaySessions, hasChosenDoctor, loadSessionQueue, selectedDoctorId]));

  const displayQueue = displayQueueState?.queue ?? queue;
  const displayCurrentServing = displayQueueState?.currentServing ?? currentServing;
  const displayCompletedCount = displayQueueState?.completedCount ?? completedCount;
  const displayActivePatientCount = displayQueue.length + (displayCurrentServing ? 1 : 0);
  const displayTotalToday = displayQueueState?.totalToday ?? completedCount + queue.length + (currentServing ? 1 : 0);
  const displayViewingSlotId = displayQueueState?.viewingSlotId ?? viewingSlotId;

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!displayCurrentServing?.startTime) {
      setElapsedTime(0);
      return;
    }

    const interval = window.setInterval(() => {
      const diff = Math.floor((Date.now() - new Date(displayCurrentServing.startTime!).getTime()) / 1000);
      setElapsedTime(diff);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [displayCurrentServing]);

  const selectedQueuePatient = useMemo(() => {
    if (!selectedToken) return displayQueue[0] || null;
    return displayQueue.find((patient) => patient.token === selectedToken) || displayQueue[0] || null;
  }, [displayQueue, selectedToken]);

  useEffect(() => {
    if (selectedToken && !displayQueue.some((patient) => patient.token === selectedToken)) {
      setSelectedToken(null);
    }
  }, [displayQueue, selectedToken]);

  const activePatient = displayCurrentServing
    ? {
        token: displayCurrentServing.token,
        name: displayCurrentServing.patientName,
        phone: displayCurrentServing.phone || "",
        patient_id: displayCurrentServing.patient_id || "",
        patient_email: displayCurrentServing.patient_email || "",
        blood_group: displayCurrentServing.blood_group || "N/A",
        doctor_delay: displayCurrentServing.doctor_delay,
        estimated_wait_minutes: displayCurrentServing.estimated_wait_minutes,
        latest_estimated_wait_minutes: displayCurrentServing.latest_estimated_wait_minutes,
        earliest_eta: displayCurrentServing.earliest_eta,
        predicted_eta: displayCurrentServing.predicted_eta,
        latest_eta: displayCurrentServing.latest_eta,
        rolling_average_minutes: displayCurrentServing.rolling_average_minutes,
        consultation_window: displayCurrentServing.consultation_window,
        estimated_window_text: displayCurrentServing.estimated_window_text,
        active_delay_minutes: displayCurrentServing.active_delay_minutes,
        queue_adjusted_time: displayCurrentServing.queue_adjusted_time,
        session_status: displayCurrentServing.session_status,
        source: displayCurrentServing.source,
        appointmentId: displayCurrentServing.appointmentId,
        status: "Serving",
      }
    : selectedQueuePatient
      ? {
          token: selectedQueuePatient.token,
          name: selectedQueuePatient.name,
          phone: selectedQueuePatient.phone || "",
          patient_id: selectedQueuePatient.patient_id || "",
          patient_email: selectedQueuePatient.patient_email || "",
          blood_group: selectedQueuePatient.blood_group || "N/A",
          doctor_delay: selectedQueuePatient.doctor_delay,
          estimated_wait_minutes: selectedQueuePatient.estimated_wait_minutes,
          latest_estimated_wait_minutes: selectedQueuePatient.latest_estimated_wait_minutes,
          earliest_eta: selectedQueuePatient.earliest_eta,
          predicted_eta: selectedQueuePatient.predicted_eta,
          latest_eta: selectedQueuePatient.latest_eta,
          rolling_average_minutes: selectedQueuePatient.rolling_average_minutes,
          consultation_window: selectedQueuePatient.consultation_window,
          estimated_window_text: selectedQueuePatient.estimated_window_text,
          active_delay_minutes: selectedQueuePatient.active_delay_minutes,
          queue_adjusted_time: selectedQueuePatient.queue_adjusted_time,
          session_status: selectedQueuePatient.session_status,
          source: selectedQueuePatient.source,
          appointmentId: selectedQueuePatient.appointment_id,
          status: "Waiting",
        }
      : null;

  const activePatientId = activePatient?.patient_id || "";

  const viewEhr = useCallback(async (visitId: number, visitDate?: string) => {
    const pid = activePatient?.patient_id;
    if (!clinicId || !pid) return;
    try {
      const response = await fetch(apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(pid)}`));
      if (!response.ok) return;
      const payload = await response.json();
      const encounters = Array.isArray(payload.encounters) ? payload.encounters : [];
      const enc = encounters.find((e: any) =>
        e.visit?.appointment_id === visitId || e.visit?.appointment_token === String(visitId)
      ) || encounters.find((e: any) =>
        visitDate && e.visit?.date === visitDate
      );
      if (!enc) return;
      navigate(`/clinic/patients/${encodeURIComponent(pid)}/encounters/${encodeURIComponent(enc.encounter_id)}/ehr?return=${encodeURIComponent("/doctor-dashboard")}`);
    } catch {
      // silently fail
    }
  }, [clinicId, activePatient?.patient_id, navigate]);

  useEffect(() => {
    if (!clinicId || (!activePatientId && !activePatient?.phone && !activePatient?.patient_email)) {
      setPatientHistory(null);
      setIsHistoryLoading(false);
      setHistoryError(null);
      return;
    }

    const controller = new AbortController();

    const fetchPatientHistory = async () => {
      try {
        setIsHistoryLoading(true);
        setHistoryError(null);
        const historyParams = new URLSearchParams();
        if (activePatient?.phone) historyParams.set("phone", activePatient.phone);
        if (activePatient?.patient_email) historyParams.set("email", activePatient.patient_email);
        const query = historyParams.toString();
        const lookupId = activePatientId || "lookup";
        const response = await fetch(apiUrl(`/api/patient/history/${encodeURIComponent(clinicId)}/${encodeURIComponent(lookupId)}${query ? `?${query}` : ""}`), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch patient history");
        const data: PatientHistory = await response.json();
        setPatientHistory(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPatientHistory(null);
        setHistoryError(error instanceof Error ? error.message : "Failed to fetch patient history");
      } finally {
        if (!controller.signal.aborted) {
          setIsHistoryLoading(false);
        }
      }
    };

    fetchPatientHistory();

    return () => controller.abort();
  }, [activePatient?.patient_email, activePatient?.phone, clinicId, activePatientId]);

  useEffect(() => {
    setIsReminderOpen(false);
    setReminderDays("30");
    setRevisitDate(addDaysInputValue(30));

    if (!clinicId || (!activePatientId && !activePatient?.phone)) {
      setLatestReminder(null);
      return;
    }

    const controller = new AbortController();

    const fetchLatestReminder = async () => {
      try {
        const params = new URLSearchParams({ clinic_id: clinicId });
        if (activePatientId) params.set("patient_id", activePatientId);
        if (activePatient?.phone) params.set("phone", activePatient.phone);
        const response = await fetch(apiUrl(`/api/patient-reminders/latest?${params.toString()}`), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to fetch reminder");
        setLatestReminder(await response.json());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLatestReminder(null);
      }
    };

    fetchLatestReminder();
    return () => controller.abort();
  }, [activePatient?.phone, activePatientId, clinicId]);

  const chooseReminderDays = (days: number) => {
    setReminderDays(String(days));
    setRevisitDate(addDaysInputValue(days));
  };

  const saveRevisitReminder = async () => {
    if (!clinicId || !activePatient) return;
    if (!revisitDate) {
      setMessage({ text: "Choose a revisit date.", type: "error" });
      return;
    }

    setIsSavingReminder(true);
    try {
      const response = await fetch(apiUrl("/api/patient-reminders"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: activePatient.patient_id || null,
          patient_name: activePatient.name,
          patient_phone: activePatient.phone || null,
          patient_email: activePatient.patient_email || null,
          appointment_id: activePatient.appointmentId || null,
          token: activePatient.token || null,
          reminder_days: Number(reminderDays) || null,
          revisit_date: revisitDate,
        }),
      });
      if (!response.ok) throw new Error("Failed to save reminder");
      const savedReminder: RevisitReminder = await response.json();
      setLatestReminder(savedReminder);
      setIsReminderOpen(false);
      setMessage({ text: `Revisit reminder saved for ${formatVisitDate(savedReminder.revisit_date)}.`, type: "success" });
    } catch {
      setMessage({ text: "Could not save revisit reminder.", type: "error" });
    } finally {
      setIsSavingReminder(false);
    }
  };

  const totalToday = displayTotalToday;
  const activeSessionDelay = activeSession?.delay_minutes ? `${activeSession.delay_minutes} min` : null;
  const activeDelay = activeSessionDelay || displayCurrentServing?.doctor_delay || displayQueue.find((patient) => patient.doctor_delay)?.doctor_delay || null;
  const activeSessionStatus = activeSession?.status || "";
  const canAnnounceDelay = Boolean(
    activeSession &&
    activeSession.is_open &&
    !["Closed", "Expired"].includes(activeSessionStatus)
  );
  const delayUnavailableMessage = activeSession
    ? `Delay can only be added to an available slot. ${activeSession.session_name} is ${activeSession.status}.`
    : "Select an available slot before adding delay.";

  const refreshQueue = useCallback(() => {
    if (clinicId) {
      fetchTodaySessions(clinicId, true, false, selectedDoctorId);
      if (activeSessionId != null) loadSessionQueue(activeSessionId, false);
    }
  }, [activeSessionId, clinicId, fetchTodaySessions, loadSessionQueue]);

  const finishCurrentPatient = useCallback(async () => {
    if (!displayCurrentServing?.appointmentId || !displayCurrentServing.clinicId) return false;

    const response = await fetch(apiUrl("/api/auth/clinic/finish-patient"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinic_id: displayCurrentServing.clinicId,
        appointment_id: displayCurrentServing.appointmentId,
        source: displayCurrentServing.source || "online",
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to complete patient");
    }

    return true;
  }, [displayCurrentServing]);

  const handleNextPatient = useCallback(async () => {
    if (!displayCurrentServing) return;

    try {
      setQueueAction("next");
      await finishCurrentPatient();
      setMessage({ text: "Patient marked as served.", type: "success" });
      setSelectedToken(null);
      await fetchTodaySessions(clinicId, true, false, selectedDoctorId);
      if (activeSessionId != null) {
        await loadSessionQueue(activeSessionId, false);
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Failed to update queue", type: "error" });
      refreshQueue();
    } finally {
      setQueueAction(null);
    }
  }, [
    activeSessionId,
    clinicId,
    displayCurrentServing,
    fetchTodaySessions,
    finishCurrentPatient,
    loadSessionQueue,
    refreshQueue,
  ]);

  const selectSession = useCallback((sessionId: number) => {
    setSelectedToken(null);
    if (sessionId !== activeSessionId) {
      setIsSessionSwitching(true);
    }
    const cachedQueue = queueCacheRef.current[sessionId];
    setDisplayQueueState(cachedQueue || emptySessionDisplayState(sessionId));
    setSelectedSessionId(sessionId);
  }, [activeSessionId]);

  const announceDelay = async () => {
    if (!clinicId) {
      setMessage({ text: "Clinic ID not found. Please log in again.", type: "error" });
      return;
    }
    if (!canAnnounceDelay) {
      setMessage({ text: delayUnavailableMessage, type: "error" });
      setIsDelayOpen(false);
      return;
    }

    const addedDelayMinutes = parseDelayMinutes(selectedDelay);
    const existingDelayMinutes = Number(activeSession?.delay_minutes || 0);
    const totalDelayMinutes = existingDelayMinutes + addedDelayMinutes;
    const delayToSave = existingDelayMinutes > 0 ? `${totalDelayMinutes} min` : selectedDelay;

    if (existingDelayMinutes > 0) {
      const shouldAdd = window.confirm(
        `This slot already has ${existingDelayMinutes} min delay. Add ${addedDelayMinutes} min more for a total of ${totalDelayMinutes} min?`
      );
      if (!shouldAdd) return;
    }

    try {
      setIsSendingDelay(true);
      const response = activeSessionId != null
        ? await fetch(apiUrl(`/api/sessions/${activeSessionId}/delay`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clinic_id: clinicId, delay: delayToSave }),
          })
        : await fetch(apiUrl(`/api/auth/doctor/announce-delay/${encodeURIComponent(clinicId)}/${encodeURIComponent(delayToSave)}`), {
            method: "POST",
          });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "Failed to announce delay");
      }
      const data = await response.json().catch(() => ({}));
      const savedDelayMinutes = Number(data.delay_minutes) || 0;
      if (activeSessionId != null && savedDelayMinutes > 0) {
        setSessions((current) => current.map((session) => (
          session.session_id === activeSessionId
            ? {
                ...session,
                delay_minutes: savedDelayMinutes,
                status: "Delayed",
                delay_started_at: data.delay_started_at || session.delay_started_at,
                delay_ends_at: data.delay_ends_at || session.delay_ends_at,
                delay_original_start_time: data.delay_original_start_time || session.delay_original_start_time || formatDelayedStartTime(session.time_range, 0),
                delay_updated_start_time: data.delay_updated_start_time || session.delay_updated_start_time || formatDelayedStartTime(session.time_range, savedDelayMinutes),
                is_delay_active: true,
              }
            : session
        )));
      }
      setDelayNotice(`${data.delay || delayToSave} delay active for this session.`);
      setMessage({ text: "Delay saved for this session.", type: "success" });
      setIsDelayOpen(false);
      refreshQueue();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Failed to announce delay", type: "error" });
    } finally {
      setIsSendingDelay(false);
    }
  };

  const cancelDelay = async () => {
    if (!clinicId || activeSessionId == null) return;
    try {
      setIsSendingDelay(true);
      setIsSessionSwitching(false);
      setDelayNotice(null);
      setIsDelayOpen(false);
      setSessions((current) => current.map((session) => (
        session.session_id === activeSessionId
          ? { ...session, delay_minutes: 0, status: "Ongoing", delay_ends_at: null, delay_started_at: null, delay_original_start_time: null, delay_updated_start_time: null, is_delay_active: false }
          : session
      )));
      const response = await fetch(apiUrl(`/api/sessions/${activeSessionId}/resume`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId }),
      });
      if (!response.ok) throw new Error("Failed to cancel delay");
      setMessage({ text: "Delay cancelled and queue restored.", type: "success" });
      await fetchTodaySessions(clinicId, true, false, selectedDoctorId);
      refreshQueue();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Failed to cancel delay", type: "error" });
      fetchTodaySessions(clinicId, true, false, selectedDoctorId);
    } finally {
      setIsSessionSwitching(false);
      setIsSendingDelay(false);
    }
  };

  const selectedDoctor = doctors.find((doctor) => doctor.doctor_id === selectedDoctorId) || null;
  const chooseDoctor = (doctor: DoctorOption) => {
    setSelectedToken(null);
    setSelectedSessionId(null);
    setSessions([]);
    setDisplayQueueState(null);
    queueCacheRef.current = {};
    setSelectedDoctorId(doctor.doctor_id);
    setHasChosenDoctor(true);
  };

  if (!hasChosenDoctor) {
    return (
      <div className="min-h-screen bg-transparent text-[#1f2522]">
        {message && (
          <div className={`fixed right-5 top-5 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${message.type === "success" ? "bg-[#1a5c4a] text-white" : "bg-red-600 text-white"}`}>
            {message.text}
          </div>
        )}

        <header className="border-b border-white/60 bg-[#fbfaf7]/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 md:px-8">
            <Link to="/clinic" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1efe8] text-[#4f5b56] transition hover:bg-[#e5e1d7]" aria-label="Back to clinic dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-[#202825]">Doctor Dashboard</p>
              <p className="mt-1 truncate text-xs text-[#77756f]">{clinicId || "No clinic selected"}</p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-8 md:px-8">
          <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/80 backdrop-blur shadow-sm">
            <div className="border-b border-[#e6ded3] bg-[#f6f1e8] p-5 md:p-7">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#dff4ea] text-[#1a5c4a]">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[#202825]">Who are you?</p>
                  <p className="mt-2 text-sm text-[#77756f]">Choose your doctor profile to open only your sessions and queue.</p>
                </div>
              </div>
            </div>

            <div className="p-5 md:p-7">
              {doctors.length === 0 ? (
                <div className="rounded-xl bg-[#f6f1e8] px-4 py-6 text-center text-sm text-[#77756f]">
                  Loading doctors...
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                  {doctors.map((doctor) => (
                    <button
                      key={doctor.doctor_id}
                      type="button"
                      onClick={() => chooseDoctor(doctor)}
                      className="group flex min-h-[132px] flex-col items-start justify-between rounded-xl border border-[#d8d1c6] bg-white p-3 text-left transition-all hover:border-[#1a5c4a] hover:bg-[#f4fbf8] hover:shadow-[0_18px_36px_-28px_rgba(26,92,74,0.75)] sm:min-h-[116px] sm:p-4"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e1f5ee] text-[#1a5c4a] sm:h-12 sm:w-12">
                        <Stethoscope className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#202825] sm:text-base">{doctor.name}</p>
                        <p className="mt-1 truncate text-xs text-[#58645f] sm:text-sm">{doctor.specialization || "General Practice"}</p>
                        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#1a5c4a]/10 px-2 py-1 text-[11px] font-bold text-[#1a5c4a] sm:mt-3 sm:gap-1.5 sm:px-2.5 sm:text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Open</span>
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-[#1f2522]">
      {message && (
        <div className={`fixed right-5 top-5 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${message.type === "success" ? "bg-[#1a5c4a] text-white" : "bg-red-600 text-white"}`}>
          {message.text}
        </div>
      )}

      <header className="border-b border-white/60 bg-[#fbfaf7]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:min-h-[72px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-0 md:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link to="/clinic" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1efe8] text-[#4f5b56] transition hover:bg-[#e5e1d7] sm:h-10 sm:w-10" aria-label="Back to clinic dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[#202825] sm:text-lg">Doctor Dashboard</p>
              <p className="mt-0.5 truncate text-xs text-[#77756f] sm:mt-1">{selectedDoctor?.name || clinicId || "No clinic selected"}{activeSession ? ` - ${activeSession.session_name}` : ""}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3">
            <div className="relative min-w-0">
              <Button
                onClick={() => {
                  if (!canAnnounceDelay) {
                    setMessage({ text: delayUnavailableMessage, type: "error" });
                    return;
                  }
                  setIsDelayOpen((open) => !open);
                }}
                disabled={!activeSession}
                className="h-9 w-full min-w-0 rounded-full bg-[#1a5c4a] px-2 text-xs text-white hover:bg-[#144d3e] disabled:cursor-not-allowed disabled:bg-[#9ca3af] sm:h-10 sm:w-auto sm:px-5 sm:text-sm"
              >
                <Megaphone className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" />
                <span className="truncate sm:hidden">{activeDelay ? activeDelay : "Delay"}</span>
                <span className="hidden sm:inline">
                  {activeDelay ? `Delay active: ${activeDelay}` : "Announce Delay"}
                </span>
              </Button>
              {isDelayOpen && (
                <div className="fixed inset-x-4 top-[92px] z-40 rounded-2xl border border-[#f59e0b] bg-[#fffbeb] p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+12px)] sm:w-[min(90vw,520px)] sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#92400e]">How long will you be delayed?</p>
                      {activeSession && <p className="mt-1 text-xs text-[#92400e]">{activeSession.session_name.replace("Time ", "Session ")}</p>}
                      {activeDelay && <p className="mt-1 text-xs text-[#92400e]">Live delay: {activeDelay}</p>}
                    </div>
                    <button type="button" onClick={() => setIsDelayOpen(false)} className="rounded-full border border-[#f59e0b]/70 px-3 py-1 text-xs font-semibold text-[#92400e] hover:bg-white">
                      Close
                    </button>
                  </div>
                  {activeDelay && (
                    <div className="mb-4 rounded-xl border border-orange-200 bg-white/75 px-4 py-3 text-sm font-semibold text-[#92400e] transition-all duration-300">
                      {activeOriginalStartTime && activeUpdatedStartTime && (
                        <>
                          <p>Original Time: <span className="line-through decoration-red-500/70 decoration-2">{activeOriginalStartTime}</span></p>
                          <p>New Time: <span className="text-[#c2410c]">{activeUpdatedStartTime}</span></p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="mb-4 flex flex-wrap gap-2">
                    {delayOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedDelay(option.value)}
                        className={`rounded-full border px-4 py-2 text-sm transition ${selectedDelay === option.value ? "border-[#f59e0b] bg-white text-[#92400e] shadow-sm" : "border-[#f59e0b]/60 bg-transparent text-[#92400e] hover:bg-white"}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Button onClick={announceDelay} disabled={isSendingDelay || !canAnnounceDelay} className="bg-green-600 hover:bg-green-700 text-white disabled:cursor-not-allowed disabled:bg-[#9ca3af]">
                    {isSendingDelay ? "Saving delay..." : activeDelay ? "Add delay" : "Save delay"}
                  </Button>
                  {activeDelay && (
                    <Button onClick={cancelDelay} disabled={isSendingDelay} variant="outline" className="ml-2 border-red-300 text-red-700 hover:bg-red-50">
                      Cancel delay
                    </Button>
                  )}
                  {delayNotice && <p className="mt-3 text-sm font-medium text-[#92400e]">{delayNotice}</p>}
                </div>
              )}
            </div>
            <Button onClick={refreshQueue} variant="outline" className="h-9 w-full rounded-full border-[#d8d1c6] bg-white/80 px-2 text-xs text-[#40514b] hover:bg-[#f6f1e8] sm:h-10 sm:w-auto sm:px-5 sm:text-sm">
              <RefreshCw className="mr-1.5 h-4 w-4 sm:mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 md:px-8 md:py-6 xl:grid-cols-[1fr_320px]">
        <section className="space-y-4 md:space-y-5">
          <div className="rounded-[26px] border border-white/70 bg-white/80 backdrop-blur p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-[#202825]">Today's Time Slots</p>
                <p className="mt-1 text-xs text-[#77756f]">Each session has its own queue, token flow, and delay state.</p>
              </div>
              {activeSession && <SessionStatusBadge status={activeSession.status} />}
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {[
                { label: "Patients", value: displayActivePatientCount },
                { label: "Done", value: displayCompletedCount },
                { label: "Waiting", value: displayQueue.length },
                { label: "Queue", value: displayCurrentServing ? "Serving" : displayQueue.length ? "Ready" : "Idle" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl bg-[#f6f1e8] px-2 py-2 text-center">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#77756f]">{item.label}</p>
                  <p className="mt-0.5 truncate text-xs font-bold text-[#202825] sm:text-sm">{item.value}</p>
                </div>
              ))}
            </div>
            {sessionsError && sessions.length > 0 && (
              <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-700">{sessionsError}</p>
            )}
            {sessionsLoading && sessions.length === 0 ? (
              <p className="rounded-xl bg-[#f6f1e8] px-4 py-5 text-center text-sm text-[#77756f]">Loading sessions...</p>
            ) : sessionsError && sessions.length === 0 ? (
              <p className="rounded-xl bg-red-50 px-4 py-5 text-center text-sm font-semibold text-red-700">{sessionsError}</p>
            ) : sessions.length === 0 ? (
              <p className="rounded-xl bg-[#f6f1e8] px-4 py-5 text-center text-sm text-[#77756f]">No sessions configured for today.</p>
            ) : (
              <div className="grid min-h-[104px] grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
                {sessions.map((session) => (
                  <SessionCard key={session.session_id} session={session} selected={activeSessionId === session.session_id} onSelect={selectSession} />
                ))}
              </div>
            )}
          </div>

          <div className="relative overflow-hidden rounded-[26px] border border-white/70 bg-white/80 backdrop-blur shadow-[0_20px_55px_-45px_rgba(18,64,54,0.65)] transition-colors duration-200">
            <SwitchingOverlay show={isSessionSwitching} />
            <div className="bg-[#1a5c4a] px-6 py-4 text-center text-white">
              <p className="font-semibold">{displayCurrentServing ? "Now Serving" : displayQueue.length ? "Next Patient" : "No Active Token"}</p>
            </div>
            <div className={`p-4 transition-opacity duration-200 md:p-6 ${isSessionSwitching ? "opacity-65" : "opacity-100"}`}>
              {activePatient ? (
                <div className="mx-auto max-w-3xl rounded-2xl border-2 border-[#99efb9] bg-[#effff5] p-4 md:p-5">
                  <div className="grid gap-4 md:grid-cols-[180px_1fr] md:items-stretch">
                    <div className="rounded-2xl bg-white/70 p-4 text-center">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#1a5c4a]">{displayCurrentServing ? "Serving token" : "Selected token"}</p>
                      <p className="mt-2 text-5xl font-extrabold tracking-[-0.04em] text-[#202638] md:text-6xl">{activePatient.token}</p>
                      {displayCurrentServing && (
                        <p className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-[#e9f7f2] px-3 py-1.5 text-sm font-semibold text-[#40514b]">
                          <Clock className="h-4 w-4" /> {formatElapsed(elapsedTime)}
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-xl font-bold text-[#202825] md:text-2xl">{activePatient.name}</p>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#1a5c4a]">{activePatient.status}</span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/70 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#77756f]">Phone</p>
                          <p className="mt-1 break-words text-sm font-bold text-[#202825]">{activePatient.phone || "N/A"}</p>
                        </div>
                        <div className="rounded-xl bg-white/70 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#77756f]">Remember</p>
                              <p className="mt-1 text-sm font-bold text-[#202825]">
                                {latestReminder ? `Revisit ${formatVisitDate(latestReminder.revisit_date)}` : "Set revisit"}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e1f5ee] text-[#1a5c4a]"
                              onClick={() => setIsReminderOpen((current) => !current)}
                              aria-label="Set revisit reminder"
                            >
                              <CalendarDays className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {isReminderOpen && (
                        <div className="mt-3 rounded-2xl border border-[#cdebdc] bg-white/80 p-3">
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {reminderQuickOptions.map((option) => (
                              <button
                                key={option.label}
                                type="button"
                                className={`rounded-full px-3 py-1 text-xs font-bold ${reminderDays === String(option.days) ? "bg-[#1a5c4a] text-white" : "bg-[#f6f1e8] text-[#40514b]"}`}
                                onClick={() => chooseReminderDays(option.days)}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                            <Input
                              type="date"
                              className="h-9 bg-white"
                              value={revisitDate}
                              onChange={(event) => setRevisitDate(event.target.value)}
                            />
                            <Button
                              type="button"
                              className="h-9 rounded-full bg-[#1a5c4a] px-4 text-xs text-white hover:bg-[#144d3e]"
                              onClick={() => void saveRevisitReminder()}
                              disabled={isSavingReminder}
                            >
                              {isSavingReminder ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <VisitHistorySidebarCard history={patientHistory} isLoading={isHistoryLoading} error={historyError} onViewEhr={viewEhr} />
                  </div>
                </div>
              ) : (
                <div className="py-7 text-center">
                  <p className="mb-3 text-5xl font-extrabold text-[#d2ccc1]">--</p>
                  <p className="text-sm text-[#77756f]">No patients in queue.</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <Button
              className="w-full rounded-xl bg-[#1a5c4a] py-6 text-base font-bold text-white shadow-sm hover:bg-[#144d3e]"
              onClick={handleNextPatient}
              disabled={queueAction !== null || isSessionSwitching || !displayCurrentServing}
            >
              <ArrowRightCircle className={`mr-2 h-5 w-5 ${queueAction === "next" ? "animate-spin" : ""}`} />
              {queueAction === "next" ? "Updating..." : "Next"}
            </Button>
          </div>

          <div className="relative min-h-[300px] rounded-[26px] border border-white/70 bg-white/80 backdrop-blur p-4 transition-colors duration-200 md:p-5">
            <SwitchingOverlay show={isSessionSwitching} />
            <div className={`transition-opacity duration-200 ${isSessionSwitching ? "opacity-65" : "opacity-100"}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[#1a5c4a]" />
                <p className="text-lg font-bold text-[#202825]">Session Queue</p>
              </div>
              {typeof displayViewingSlotId === "number" && (
                <span className="rounded-full bg-[#f1efe8] px-3 py-1 text-xs font-semibold text-[#40514b]">Slot {displayViewingSlotId}</span>
              )}
            </div>

            {displayActivePatientCount === 0 ? (
              <p className="rounded-xl bg-[#f6f1e8] px-4 py-6 text-center text-sm text-[#77756f]">No patients in this session.</p>
            ) : (
              <div className="space-y-3">
                {displayCurrentServing && (
                  <button
                    type="button"
                    onClick={() => setSelectedToken(null)}
                    className="grid w-full grid-cols-[64px_1fr] items-center gap-3 rounded-xl border border-[#1a5c4a] bg-[#e9f7f2] px-3 py-3 text-left transition sm:grid-cols-[72px_1fr_auto] sm:px-4"
                  >
                    <div className="rounded-xl bg-[#fff0bf] px-3 py-2 text-center font-bold text-[#7a5800]">{displayCurrentServing.token}</div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#202825]">{displayCurrentServing.patientName}</p>
                      <p className="truncate text-xs text-[#77756f]">{displayCurrentServing.phone || "No phone"} - Blood: {displayCurrentServing.blood_group || "N/A"}</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <SourceBadge source={displayCurrentServing.source} />
                      <span className="rounded-full bg-[#1a5c4a] px-2 py-1 text-xs font-bold text-white">Serving</span>
                    </div>
                  </button>
                )}
                {displayQueue.map((patient, index) => (
                  <button
                    key={`${patient.source}-${patient.appointment_id || patient.token}`}
                    type="button"
                    onClick={() => setSelectedToken(patient.token)}
                    className={`grid w-full grid-cols-[64px_1fr] items-center gap-3 rounded-xl border px-3 py-3 text-left transition sm:grid-cols-[72px_1fr_auto] sm:px-4 ${selectedQueuePatient?.token === patient.token ? "border-[#1a5c4a] bg-[#e9f7f2]" : "border-[#e6ded3] bg-white/85 hover:bg-[#f6f1e8]"}`}
                  >
                    <div className="rounded-xl bg-[#fff0bf] px-3 py-2 text-center font-bold text-[#7a5800]">{patient.token}</div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#202825]">{patient.name}</p>
                      <p className="truncate text-xs text-[#77756f]">{patient.phone || "No phone"} - Blood: {patient.blood_group || "N/A"}</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <SourceBadge source={patient.source} />
                      <span className="rounded-full bg-[#f1efe8] px-2 py-1 text-xs font-bold text-[#77756f]">#{index + 1 + (displayCurrentServing ? 1 : 0)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
        </section>

        <aside className="hidden space-y-5 xl:block">
          <div className="min-h-[260px] rounded-[26px] border border-white/70 bg-white/80 backdrop-blur p-5 transition-colors duration-200">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.08em] text-[#77756f]">Current Patient</p>
            {activePatient ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e1f5ee] text-base font-bold text-[#1a5c4a]">
                    {initials(activePatient.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-[#202825]">{activePatient.name}</p>
                    <p className="text-sm text-[#77756f]">{activePatient.token}</p>
                  </div>
                </div>
                <PatientAiPanel history={patientHistory} isLoading={isHistoryLoading} error={historyError} patient={{ id: activePatient.patient_id || undefined, name: activePatient.name, token: activePatient.token, phone: activePatient.phone, email: activePatient.patient_email, clinicId, doctorId: selectedDoctorId, appointmentId: activePatient.appointmentId }} />
              </div>
            ) : (
              <div>
                <p className="text-sm text-[#77756f]">Select a patient from the waiting queue to view details.</p>
                <EmptyPatientAiPanel />
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
