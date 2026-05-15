import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRightCircle, Clock, Megaphone, PauseCircle, Play, RefreshCw, SkipForward, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueue } from "@/context/QueueContext";
import { apiUrl } from "@/lib/api";

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

interface PatientHistoryNote {
  date: string;
  diagnosis?: string;
  notes?: string;
}

interface PatientHistory {
  is_returning: boolean;
  visit_count: number;
  last_visit: string | null;
  previous_notes: PatientHistoryNote[];
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
  is_active: boolean;
}

interface SessionsResponse {
  sessions: DoctorSessionSlot[];
  active_session_id: number | null;
}

interface QueueDisplayState {
  queue: Array<{
    token: string;
    name: string;
    phone?: string;
    patient_id?: string;
    patient_email?: string;
    blood_group?: string;
    doctor_delay?: string | null;
    estimated_wait_minutes?: number | null;
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
    appointmentId?: number;
    clinicId?: string;
    source?: "online" | "desk" | "walkin" | "skipped";
  } | null;
  completedCount: number;
  skippedCount: number;
  totalToday: number;
  viewingSlotId: number | null;
}

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

function VisitHistoryDetails({ history }: { history: PatientHistory }) {
  const notes = history.previous_notes || [];
  if (!notes.length) return null;

  return (
    <details className="mt-3 rounded-lg border border-[#d8d1c6] bg-white/70 px-3 py-2 text-left">
      <summary className="cursor-pointer text-xs font-bold text-[#1a5c4a]">Previous Consultation Notes</summary>
      <div className="mt-3 space-y-3">
        {notes.map((note, index) => (
          <div key={`${note.date}-${index}`} className="border-t border-[#e6ded3] pt-2 first:border-t-0 first:pt-0">
            <p className="text-xs font-bold text-[#202825]">{formatVisitDate(note.date)}</p>
            {note.diagnosis && <p className="mt-1 text-xs text-[#40514b]">Diagnosis: {note.diagnosis}</p>}
            {note.notes && <p className="mt-1 text-xs text-[#40514b]">Notes: {note.notes}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

const VisitHistorySidebarCard = memo(function VisitHistorySidebarCard({ history, isLoading, error }: { history: PatientHistory | null; isLoading: boolean; error: string | null }) {
  const isReturning = Boolean(history?.is_returning);

  return (
    <div className="rounded-xl bg-[#f0ede6] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-[#77756f]">Visit History</p>
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
              <p className="text-sm font-semibold text-[#202825]">Visited this clinic {history.visit_count} {history.visit_count === 1 ? "time" : "times"}</p>
              <p className="text-xs text-[#58645f]">Last visit: {formatVisitDate(history.last_visit)}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm font-semibold text-[#202825]">First visit to this clinic</p>
          )}
          <VisitHistoryDetails history={history} />
        </div>
      ) : (
        <p className="text-sm font-semibold text-[#40514b]">No history found</p>
      )}
    </div>
  );
});

const VisitHistoryInlineSummary = memo(function VisitHistoryInlineSummary({ history, isLoading }: { history: PatientHistory | null; isLoading: boolean }) {
  if (isLoading) {
    return <p className="mt-2 text-sm font-semibold text-[#40514b]">Previous Visits: Checking...</p>;
  }

  const visitCount = history?.visit_count || 0;
  if (!history || visitCount === 0) {
    return (
      <div className="mt-2 space-y-1 text-sm font-semibold text-[#40514b]">
        <p>Previous Visits: 0</p>
        <p>First Time Patient</p>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1 text-sm font-semibold text-[#40514b]">
      <p>Previous Visits: {visitCount}</p>
      <p>Last Visit: {formatVisitDate(history.last_visit)}</p>
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
  return (
    <button
      type="button"
      onClick={() => onSelect(session.session_id)}
      className={`min-w-0 rounded-xl border-2 p-4 text-left transition hover:shadow-sm ${selected ? "border-[#1a5c4a] bg-[#e9f7f2]" : "border-[#e6ded3] bg-white hover:border-[#b7d7c8]"}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#202825]">{session.session_name.replace("Time ", "Session ")}</p>
          <p className="mt-1 text-xs font-semibold text-[#58645f]">{session.time_label}</p>
        </div>
        <SessionStatusBadge status={session.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#f0ede6] px-3 py-2">
          <p className="text-[#77756f]">Queue</p>
          <p className="mt-1 font-bold text-[#202825]">{session.queue_count} patients</p>
        </div>
        <div className="rounded-lg bg-[#f0ede6] px-3 py-2">
          <p className="text-[#77756f]">Completed</p>
          <p className="mt-1 font-bold text-[#202825]">{session.completed_count}</p>
        </div>
      </div>
      {session.delay_minutes > 0 && <p className="mt-2 text-xs font-semibold text-[#c2410c]">Delay: {session.delay_minutes} min</p>}
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

const StatCard = memo(function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-[#f0ede6] px-5 py-4">
      <p className="mb-2 text-xs text-[#77756f]">{label}</p>
      <p className={`text-2xl font-semibold ${accent ? "text-[#1a5c4a]" : "text-[#2c2c2a]"}`}>{value}</p>
    </div>
  );
});

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
  const {
    queue,
    currentServing,
    completedCount,
    skippedCount,
    fetchQueueForClinic,
    nextPatient,
    completePatient,
    skipPatient,
    viewingSlotId,
  } = useQueue();

  const [clinicId, setClinicId] = useState("");
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
  const [sessions, setSessions] = useState<DoctorSessionSlot[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [displayQueueState, setDisplayQueueState] = useState<QueueDisplayState | null>(null);
  const [isSessionSwitching, setIsSessionSwitching] = useState(false);
  const queueRequestRef = useRef(0);
  const queueCacheRef = useRef<Record<number, QueueDisplayState>>({});
  const sessionsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const storedClinicId = localStorage.getItem("clinic_id") || "";
    setClinicId(storedClinicId);
  }, []);

  const fetchTodaySessions = useCallback(async (clinic: string, keepSelection = true, showLoading = true) => {
    if (!clinic) return;

    sessionsAbortRef.current?.abort();
    const controller = new AbortController();
    sessionsAbortRef.current = controller;

    try {
      if (showLoading) setSessionsLoading(true);
      setSessionsError(null);
      const response = await fetch(apiUrl(`/api/sessions/today/${encodeURIComponent(clinic)}`), { signal: controller.signal });
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
      fetchTodaySessions(clinicId);
    }
  }, [clinicId, fetchTodaySessions]);

  const activeSessionId = selectedSessionId ?? viewingSlotId ?? sessions.find((session) => session.is_active)?.session_id ?? sessions[0]?.session_id ?? null;
  const activeSession = sessions.find((session) => session.session_id === activeSessionId) || null;

  const loadSessionQueue = useCallback(async (sessionId: number, showOverlay = true) => {
    if (!clinicId) return;

    const requestId = ++queueRequestRef.current;
    if (showOverlay) setIsSessionSwitching(true);

    const snapshot = await fetchQueueForClinic(clinicId, sessionId);
    if (requestId !== queueRequestRef.current) return;

    if (snapshot) {
      const nextDisplayState: QueueDisplayState = {
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

    if (showOverlay) setIsSessionSwitching(false);
  }, [clinicId, fetchQueueForClinic]);

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

    const nextDisplayState: QueueDisplayState = {
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
    if (!clinicId) return;

    const interval = window.setInterval(() => {
      fetchTodaySessions(clinicId, true, false);
      if (activeSessionId != null) {
        loadSessionQueue(activeSessionId, false);
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [clinicId, activeSessionId, fetchTodaySessions, loadSessionQueue]);

  const displayQueue = displayQueueState?.queue ?? queue;
  const displayCurrentServing = displayQueueState?.currentServing ?? currentServing;
  const displayCompletedCount = displayQueueState?.completedCount ?? completedCount;
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
        blood_group: displayCurrentServing.blood_group || "N/A",
        doctor_delay: displayCurrentServing.doctor_delay,
        estimated_wait_minutes: displayCurrentServing.estimated_wait_minutes,
        source: displayCurrentServing.source,
        status: "Serving",
      }
    : selectedQueuePatient
      ? {
          token: selectedQueuePatient.token,
          name: selectedQueuePatient.name,
          phone: selectedQueuePatient.phone || "",
          patient_id: selectedQueuePatient.patient_id || "",
          blood_group: selectedQueuePatient.blood_group || "N/A",
          doctor_delay: selectedQueuePatient.doctor_delay,
          estimated_wait_minutes: selectedQueuePatient.estimated_wait_minutes,
          source: selectedQueuePatient.source,
          status: "Waiting",
        }
      : null;

  const activePatientId = activePatient?.patient_id || "";

  useEffect(() => {
    if (!clinicId || !activePatientId) {
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
        const response = await fetch(apiUrl(`/api/patient/history/${encodeURIComponent(clinicId)}/${encodeURIComponent(activePatientId)}`), {
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
  }, [clinicId, activePatientId]);

  const totalToday = displayTotalToday;
  const activeDelay = displayCurrentServing?.doctor_delay || displayQueue.find((patient) => patient.doctor_delay)?.doctor_delay || null;

  const refreshQueue = useCallback(() => {
    if (clinicId) {
      fetchTodaySessions(clinicId, true, false);
      if (activeSessionId != null) loadSessionQueue(activeSessionId, true);
    }
  }, [activeSessionId, clinicId, fetchTodaySessions, loadSessionQueue]);

  const selectSession = useCallback((sessionId: number) => {
    setSelectedToken(null);
    if (sessionId !== activeSessionId) {
      setIsSessionSwitching(true);
    }
    const cachedQueue = queueCacheRef.current[sessionId];
    if (cachedQueue) {
      setDisplayQueueState(cachedQueue);
    }
    setSelectedSessionId(sessionId);
  }, [activeSessionId]);

  const runSessionAction = async (action: "start" | "pause" | "resume" | "close") => {
    if (!clinicId || activeSessionId == null) return;
    try {
      setSessionAction(action);
      const response = await fetch(apiUrl(`/api/sessions/${activeSessionId}/${action}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId }),
      });
      if (!response.ok) throw new Error(`Failed to ${action} session`);
      setMessage({ text: `Session ${action} updated.`, type: "success" });
      refreshQueue();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : `Failed to ${action} session`, type: "error" });
    } finally {
      setSessionAction(null);
    }
  };

  const announceDelay = async () => {
    if (!clinicId) {
      setMessage({ text: "Clinic ID not found. Please log in again.", type: "error" });
      return;
    }

    try {
      setIsSendingDelay(true);
      const response = activeSessionId != null
        ? await fetch(apiUrl(`/api/sessions/${activeSessionId}/delay`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clinic_id: clinicId, delay: selectedDelay }),
          })
        : await fetch(apiUrl(`/api/auth/doctor/announce-delay/${encodeURIComponent(clinicId)}/${encodeURIComponent(selectedDelay)}`), {
            method: "POST",
          });
      if (!response.ok) throw new Error("Failed to announce delay");
      const data = await response.json().catch(() => ({}));
      const notified = data.notified_count || data.clinic_notified_count || 0;
      setDelayNotice(notified > 0 ? `${data.delay || selectedDelay} delay active. ${notified} notification${notified === 1 ? "" : "s"} sent.` : `${data.delay || selectedDelay} delay saved. Notifications were not sent; check SMTP setup.`);
      setMessage({ text: notified > 0 ? "Delay notification sent." : "Delay saved, but notification email was not sent.", type: notified > 0 ? "success" : "error" });
      setIsDelayOpen(false);
      refreshQueue();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Failed to announce delay", type: "error" });
    } finally {
      setIsSendingDelay(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f3ee] text-[#1f2522]">
      {message && (
        <div className={`fixed right-5 top-5 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${message.type === "success" ? "bg-[#1a5c4a] text-white" : "bg-red-600 text-white"}`}>
          {message.text}
        </div>
      )}

      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex min-h-[72px] max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
          <div className="flex items-center gap-4">
            <Link to="/clinic" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f1efe8] text-[#4f5b56] transition hover:bg-[#e5e1d7]" aria-label="Back to clinic dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <p className="text-lg font-semibold text-[#202825]">Doctor Dashboard</p>
              <p className="mt-1 text-xs text-[#77756f]">{clinicId || "No clinic selected"}{activeSession ? ` - ${activeSession.session_name}` : ""}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Button onClick={() => setIsDelayOpen((open) => !open)} className="rounded-full bg-[#1a5c4a] px-5 text-white hover:bg-[#144d3e]">
                <Megaphone className="mr-2 h-4 w-4" />
                {activeDelay ? `Delay active - ${activeDelay}` : "Announce Delay"}
              </Button>
              {isDelayOpen && (
                <div className="absolute right-0 top-[calc(100%+12px)] z-40 w-[min(90vw,520px)] rounded-2xl border border-[#f59e0b] bg-[#fffbeb] p-5 shadow-xl">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#92400e]">How long will you be delayed?</p>
                      {activeDelay && <p className="mt-1 text-xs text-[#92400e]">Live delay: {activeDelay}</p>}
                    </div>
                    <button type="button" onClick={() => setIsDelayOpen(false)} className="rounded-full border border-[#f59e0b]/70 px-3 py-1 text-xs font-semibold text-[#92400e] hover:bg-white">
                      Cancel
                    </button>
                  </div>
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
                  <Button onClick={announceDelay} disabled={isSendingDelay} className="bg-green-600 hover:bg-green-700 text-white">
                    {isSendingDelay ? "Sending clinic email..." : "Send delay email to clinic"}
                  </Button>=
                  {delayNotice && <p className="mt-3 text-sm font-medium text-[#92400e]">{delayNotice}</p>}
                </div>
              )}
            </div>
            <Button onClick={refreshQueue} variant="outline" className="rounded-full border-[#d8d1c6] bg-white px-5 text-[#40514b] hover:bg-[#f5f3ee]">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-5 py-6 md:px-8 xl:grid-cols-[1fr_320px]">
        <section className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total today" value={totalToday} accent />
            <StatCard label="Completed" value={displayCompletedCount} />
            <StatCard label="Waiting" value={displayQueue.length} />
            <StatCard label="Queue" value={displayCurrentServing ? "Serving" : displayQueue.length ? "Ready" : "Idle"} />
          </div>

          <div className="rounded-2xl border border-black/10 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-[#202825]">Today's Time Slots</p>
                <p className="mt-1 text-xs text-[#77756f]">Each session has its own queue, token flow, and delay state.</p>
              </div>
              {activeSession && <SessionStatusBadge status={activeSession.status} />}
            </div>
            {sessionsError && sessions.length > 0 && (
              <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-700">{sessionsError}</p>
            )}
            {sessionsLoading && sessions.length === 0 ? (
              <p className="rounded-xl bg-[#f8f6f2] px-4 py-5 text-center text-sm text-[#77756f]">Loading sessions...</p>
            ) : sessionsError && sessions.length === 0 ? (
              <p className="rounded-xl bg-red-50 px-4 py-5 text-center text-sm font-semibold text-red-700">{sessionsError}</p>
            ) : sessions.length === 0 ? (
              <p className="rounded-xl bg-[#f8f6f2] px-4 py-5 text-center text-sm text-[#77756f]">No sessions configured for today.</p>
            ) : (
              <div className="grid min-h-[136px] gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sessions.map((session) => (
                  <SessionCard key={session.session_id} session={session} selected={activeSessionId === session.session_id} onSelect={selectSession} />
                ))}
              </div>
            )}
            {activeSession && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => runSessionAction("start")} disabled={sessionAction !== null} className="rounded-full border-[#d8d1c6] bg-white text-[#40514b] hover:bg-[#f5f3ee]">
                  <Play className="mr-2 h-4 w-4" /> Start
                </Button>
                <Button variant="outline" onClick={() => runSessionAction("pause")} disabled={sessionAction !== null} className="rounded-full border-[#d8d1c6] bg-white text-[#40514b] hover:bg-[#f5f3ee]">
                  <PauseCircle className="mr-2 h-4 w-4" /> Pause
                </Button>
                <Button variant="outline" onClick={() => runSessionAction("resume")} disabled={sessionAction !== null} className="rounded-full border-[#d8d1c6] bg-white text-[#40514b] hover:bg-[#f5f3ee]">
                  <RefreshCw className="mr-2 h-4 w-4" /> Resume
                </Button>
                <Button variant="outline" onClick={() => runSessionAction("close")} disabled={sessionAction !== null} className="rounded-full border-red-200 bg-white text-red-700 hover:bg-red-50">
                  <XCircle className="mr-2 h-4 w-4" /> Close
                </Button>
              </div>
            )}
          </div>

          <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_20px_55px_-45px_rgba(18,64,54,0.65)] transition-colors duration-200">
            <SwitchingOverlay show={isSessionSwitching} />
            <div className="bg-[#1a5c4a] px-6 py-4 text-center text-white">
              <p className="font-semibold">{displayCurrentServing ? "Now Serving" : displayQueue.length ? "Next Patient" : "No Active Token"}</p>
            </div>
            <div className={`p-6 text-center transition-opacity duration-200 ${isSessionSwitching ? "opacity-65" : "opacity-100"}`}>
              {activePatient ? (
                <>
                  <p className="mb-5 text-5xl font-extrabold tracking-[-0.04em] text-[#202638]">{activePatient.token}</p>
                  <div className="mx-auto max-w-2xl rounded-xl border-2 border-[#99efb9] bg-[#effff5] px-5 py-5">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <p className="text-xl font-bold text-[#202825]">{activePatient.name}</p>
                      <SourceBadge source={activePatient.source} />
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#1a5c4a]">{activePatient.status}</span>
                    </div>
                    {activePatient.phone && <p className="mt-2 text-sm text-[#58645f]">{activePatient.phone}</p>}
                    <p className="mt-2 text-sm font-semibold text-[#40514b]">Blood group: {activePatient.blood_group}</p>
                    <VisitHistoryInlineSummary history={patientHistory} isLoading={isHistoryLoading} />
                    {activePatient.estimated_wait_minutes != null && <p className="mt-1 text-xs text-[#58645f]">Updated wait: {activePatient.estimated_wait_minutes} min</p>}
                    {displayCurrentServing && (
                      <p className="mt-3 inline-flex items-center gap-2 text-sm text-[#40514b]">
                        <Clock className="h-4 w-4" /> Elapsed: {formatElapsed(elapsedTime)}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="py-7">
                  <p className="mb-3 text-5xl font-extrabold text-[#d2ccc1]">--</p>
                  <p className="text-sm text-[#77756f]">No patients in queue.</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Button
              className={`rounded-xl py-6 text-base font-bold shadow-sm ${displayCurrentServing ? "bg-[#FFC107] text-[#111827] hover:bg-[#f0b400]" : "bg-[#1a5c4a] text-white hover:bg-[#144d3e]"}`}
              onClick={() => displayCurrentServing ? completePatient() : nextPatient()}
              disabled={isSessionSwitching || (!displayCurrentServing && displayQueue.length === 0)}
            >
              <ArrowRightCircle className="mr-2 h-5 w-5" />
              {displayCurrentServing ? "Mark Completed" : "Start Next Patient"}
            </Button>
            <Button
              variant="outline"
              className="rounded-xl border-[#d8d1c6] py-6 text-base font-bold text-[#40514b] hover:bg-white"
              onClick={() => skipPatient()}
              disabled={isSessionSwitching || displayQueue.length === 0}
            >
              <SkipForward className="mr-2 h-5 w-5" />
              Skip Next Patient
            </Button>
          </div>

          <div className="relative min-h-[300px] rounded-2xl border border-black/10 bg-white p-5 transition-colors duration-200">
            <SwitchingOverlay show={isSessionSwitching} />
            <div className={`transition-opacity duration-200 ${isSessionSwitching ? "opacity-65" : "opacity-100"}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[#1a5c4a]" />
                <p className="text-lg font-bold text-[#202825]">Waiting Queue</p>
              </div>
              {typeof displayViewingSlotId === "number" && (
                <span className="rounded-full bg-[#f1efe8] px-3 py-1 text-xs font-semibold text-[#40514b]">Slot {displayViewingSlotId}</span>
              )}
            </div>

            {displayQueue.length === 0 ? (
              <p className="rounded-xl bg-[#f8f6f2] px-4 py-6 text-center text-sm text-[#77756f]">No waiting patients.</p>
            ) : (
              <div className="space-y-3">
                {displayQueue.map((patient, index) => (
                  <button
                    key={`${patient.source}-${patient.appointment_id || patient.token}`}
                    type="button"
                    onClick={() => setSelectedToken(patient.token)}
                    className={`grid w-full grid-cols-[72px_1fr_auto] items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${selectedQueuePatient?.token === patient.token ? "border-[#1a5c4a] bg-[#e9f7f2]" : "border-[#e6ded3] bg-white hover:bg-[#fbfaf7]"}`}
                  >
                    <div className="rounded-xl bg-[#fff0bf] px-3 py-2 text-center font-bold text-[#7a5800]">{patient.token}</div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#202825]">{patient.name}</p>
                      <p className="truncate text-xs text-[#77756f]">{patient.phone || "No phone"} - Blood: {patient.blood_group || "N/A"}</p>
                      {patient.estimated_wait_minutes != null && <p className="truncate text-xs text-[#77756f]">Est. wait {patient.estimated_wait_minutes} min</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <SourceBadge source={patient.source} />
                      <span className="rounded-full bg-[#f1efe8] px-2 py-1 text-xs font-bold text-[#77756f]">#{index + 1}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="min-h-[420px] rounded-2xl border border-black/10 bg-white p-5 transition-colors duration-200">
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
                <div className="grid gap-3">
                  <div className="rounded-xl bg-[#f0ede6] p-3">
                    <p className="mb-1 text-xs text-[#77756f]">Phone</p>
                    <p className="font-semibold text-[#202825]">{activePatient.phone || "N/A"}</p>
                  </div>
                  <div className="rounded-xl bg-[#f0ede6] p-3">
                    <p className="mb-1 text-xs text-[#77756f]">Source</p>
                    <p className="font-semibold text-[#202825]">{sourceLabel(activePatient.source)}</p>
                  </div>
                  <div className="rounded-xl bg-[#f0ede6] p-3">
                    <p className="mb-1 text-xs text-[#77756f]">Status</p>
                    <p className="font-semibold text-[#202825]">{activePatient.status}</p>
                  </div>
                  <VisitHistorySidebarCard history={patientHistory} isLoading={isHistoryLoading} error={historyError} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#77756f]">Select a patient from the waiting queue to view details.</p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}





