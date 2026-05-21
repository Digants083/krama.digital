import { createContext, useContext, useState, useCallback, useRef } from "react";

type QueueItem = {
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
  doctor_id?: string;
  appointment_id?: number;
  queue_position?: number;
  slot_id?: number;
};

type QueueStats = {
  total_waiting: number;
  currently_serving: number;
  completed_today: number;
  average_wait_time: string | null;
};

type CurrentServing = {
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
  doctor_id?: string;
  source?: "online" | "desk" | "walkin" | "skipped";
};

type QueueAppointment = {
  id?: number;
  token?: string;
  patient_name?: string;
  patient_phone?: string;
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
  source?: string;
  clinic_id?: string;
  doctor_id?: string;
  queue_position?: number;
  slot_id?: number;
  status?: string;
  created_at?: string;
  serving_started_at?: string;
};

type QueueSnapshot = {
  queue: QueueItem[];
  currentServing: CurrentServing | null;
  completedCount: number;
  skippedCount: number;
  totalToday: number;
  currentToken: number;
  activeSlotId: number | null;
  viewingSlotId: number | null;
};

type WalkinPayload = {
  clinic_id: string;
  doctor_id: string;
  patient_name: string;
  phone: string;
};

type WalkinResult = {
  token_number: number;
  token_label: string;
  position: number;
  estimated_wait_minutes?: number | null;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  rolling_average_minutes?: number | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  active_delay_minutes?: number | null;
  queue_adjusted_time?: string | null;
  session_status?: string | null;
};

type QueueContextType = {
  queue: QueueItem[];
  currentToken: number;
  queueStats: QueueStats | null;
  completedCount: number;
  skippedCount: number;
  totalToday: number;
  currentServing: CurrentServing | null;
  activeSlotId: number | null;
  viewingSlotId: number | null;
  nextPatient: () => Promise<void>;
  completePatient: () => Promise<void>;
  skipPatient: () => Promise<void>;
  fetchQueueStats: (clinicId: string) => void;
  fetchQueueForClinic: (clinicId: string, slotId?: number | null, preserveStartTime?: Date, doctorId?: string | null) => Promise<QueueSnapshot | null>;
  addWalkinToQueue: (payload: WalkinPayload) => Promise<WalkinResult>;
  addPatient: (name: string, source: "online" | "desk") => void;
  resetQueue: () => void;
};

const QueueContext = createContext<QueueContextType | null>(null);

export const useQueue = () => {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useQueue must be used inside QueueProvider");
  return ctx;
};

const API_BASE = "/api";

export const QueueProvider = ({ children }: { children: React.ReactNode }) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentToken, setCurrentToken] = useState(0);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [totalToday, setTotalToday] = useState(0);
  const [currentServing, setCurrentServing] = useState<CurrentServing | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [viewingSlotId, setViewingSlotId] = useState<number | null>(null);
  const latestQueueRequest = useRef(0);

  const fetchQueueForClinic = useCallback(async (clinicId: string, slotId?: number | null, preserveStartTime?: Date, doctorId?: string | null): Promise<QueueSnapshot | null> => {
    const requestId = ++latestQueueRequest.current;

    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (typeof slotId === "number") {
        params.set("slot_id", String(slotId));
      }
      if (doctorId) {
        params.set("doctor_id", doctorId);
      }

      const response = await fetch(`${API_BASE}/auth/appointments/today?${params.toString()}`);
      if (!response.ok) return null;

      const data = await response.json();
      const appointments: QueueAppointment[] = data.appointments || [];
      const nextActiveSlotId = typeof data.active_slot_id === "number" ? data.active_slot_id : null;
      const nextViewingSlotId = typeof data.viewing_slot_id === "number" ? data.viewing_slot_id : null;

      const servingAppointment = appointments.find((apt) => apt.status === "serving");
      const waitingAppointments = appointments.filter((apt) => apt.status !== "serving");

      const queueItems: QueueItem[] = waitingAppointments.map((apt, index) => ({
        token: apt.token || `T-${index + 1}`,
        name: apt.patient_name || "Patient",
        phone: apt.patient_phone,
        patient_id: apt.patient_id,
        patient_email: apt.patient_email,
        blood_group: apt.blood_group,
        doctor_delay: apt.doctor_delay,
        estimated_wait_minutes: apt.estimated_wait_minutes,
        latest_estimated_wait_minutes: apt.latest_estimated_wait_minutes,
        earliest_eta: apt.earliest_eta,
        predicted_eta: apt.predicted_eta,
        latest_eta: apt.latest_eta,
        rolling_average_minutes: apt.rolling_average_minutes,
        consultation_window: apt.consultation_window,
        estimated_window_text: apt.estimated_window_text,
        active_delay_minutes: apt.active_delay_minutes,
        queue_adjusted_time: apt.queue_adjusted_time,
        session_status: apt.session_status,
        source: apt.source === "walkin" ? "walkin" : "online",
        clinic_id: apt.clinic_id || clinicId,
        doctor_id: apt.doctor_id,
        appointment_id: apt.id,
        queue_position: apt.queue_position,
        slot_id: apt.slot_id,
      }));

      const nextCurrentServing: CurrentServing | null = servingAppointment
        ? {
            patientName: servingAppointment.patient_name || "Patient",
            token: servingAppointment.token || "T-1",
            position: 1,
            phone: servingAppointment.patient_phone,
            patient_id: servingAppointment.patient_id,
            patient_email: servingAppointment.patient_email,
            blood_group: servingAppointment.blood_group,
            doctor_delay: servingAppointment.doctor_delay,
            estimated_wait_minutes: servingAppointment.estimated_wait_minutes,
            latest_estimated_wait_minutes: servingAppointment.latest_estimated_wait_minutes,
            earliest_eta: servingAppointment.earliest_eta,
            predicted_eta: servingAppointment.predicted_eta,
            latest_eta: servingAppointment.latest_eta,
            rolling_average_minutes: servingAppointment.rolling_average_minutes,
            consultation_window: servingAppointment.consultation_window,
            estimated_window_text: servingAppointment.estimated_window_text,
            active_delay_minutes: servingAppointment.active_delay_minutes,
            queue_adjusted_time: servingAppointment.queue_adjusted_time,
            session_status: servingAppointment.session_status,
            startTime: preserveStartTime || (servingAppointment.serving_started_at ? new Date(servingAppointment.serving_started_at) : null),
            appointmentId: servingAppointment.id,
            clinicId: servingAppointment.clinic_id,
            doctor_id: servingAppointment.doctor_id,
            source: servingAppointment.source === "walkin" ? "walkin" : "online",
          }
        : null;

      const nextCurrentToken = servingAppointment?.token
        ? Number.parseInt(String(servingAppointment.token).replace(/[^\d]/g, ""), 10) || 0
        : 0;

      let nextCompletedCount = 0;
      let nextSkippedCount = 0;
      const statsResponse = await fetch(`${API_BASE}/auth/queue/history/stats?clinic_id=${clinicId}${typeof slotId === "number" ? `&slot_id=${slotId}` : ""}${doctorId ? `&doctor_id=${encodeURIComponent(doctorId)}` : ""}`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        nextCompletedCount = statsData.total_patients_served || 0;
        nextSkippedCount = statsData.total_skipped || 0;
      }

      const snapshot: QueueSnapshot = {
        queue: queueItems,
        currentServing: nextCurrentServing,
        completedCount: nextCompletedCount,
        skippedCount: nextSkippedCount,
        totalToday: appointments.length,
        currentToken: nextCurrentToken,
        activeSlotId: nextActiveSlotId,
        viewingSlotId: nextViewingSlotId,
      };

      if (requestId === latestQueueRequest.current) {
        setActiveSlotId(nextActiveSlotId);
        setViewingSlotId(nextViewingSlotId);
        setQueue(queueItems);
        setTotalToday(appointments.length);
        setCurrentServing(nextCurrentServing);
        setCurrentToken(nextCurrentToken);
        setCompletedCount(nextCompletedCount);
        setSkippedCount(nextSkippedCount);
      }

      return snapshot;
    } catch (error) {
      console.error("Failed to fetch queue:", error);
      return null;
    }
  }, []);

  const fetchQueueStats = useCallback(async (clinicId: string) => {
    try {
      const response = await fetch(`${API_BASE}/queue/stats/${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        setQueueStats(data);
        setCurrentToken(data.currently_serving);
      }
    } catch (error) {
      console.error("Failed to fetch queue stats:", error);
    }
  }, []);

  const addWalkinToQueue = useCallback(
    async (payload: WalkinPayload): Promise<WalkinResult> => {
      const res = await fetch(`${API_BASE}/auth/queue/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: payload.clinic_id,
          doctor_id: payload.doctor_id,
          patient_name: payload.patient_name,
          phone: payload.phone,
          source: "walkin",
          booking_id: null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to join queue");
      }

      const data = await res.json();

      const newItem: QueueItem = {
        token: data.token_label || `W-${data.token_number}`,
        name: payload.patient_name,
        phone: payload.phone,
        estimated_wait_minutes: data.estimated_wait_minutes,
        earliest_eta: data.earliest_eta,
        predicted_eta: data.predicted_eta,
        latest_eta: data.latest_eta,
        rolling_average_minutes: data.rolling_average_minutes,
        consultation_window: data.consultation_window,
        estimated_window_text: data.estimated_window_text,
        active_delay_minutes: data.active_delay_minutes,
        queue_adjusted_time: data.queue_adjusted_time,
        session_status: data.session_status,
        source: "walkin",
        clinic_id: payload.clinic_id,
      };

      setQueue((prev) => [...prev, newItem]);
      setTotalToday((prev) => prev + 1);

      return {
        token_number: data.token_number,
        token_label: data.token_label || `W-${data.token_number}`,
        position: data.position,
        estimated_wait_minutes: data.estimated_wait_minutes,
        earliest_eta: data.earliest_eta,
        predicted_eta: data.predicted_eta,
        latest_eta: data.latest_eta,
        rolling_average_minutes: data.rolling_average_minutes,
        consultation_window: data.consultation_window,
        estimated_window_text: data.estimated_window_text,
        active_delay_minutes: data.active_delay_minutes,
        queue_adjusted_time: data.queue_adjusted_time,
        session_status: data.session_status,
      };
    },
    []
  );

  const nextPatient = useCallback(async () => {
    if (queue.length > 0) {
      const patient = queue[0];
      try {
        const response = await fetch(`${API_BASE}/auth/clinic/serve-patient`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: patient.clinic_id,
            appointment_id: patient.appointment_id,
            source: patient.source,
          }),
        });

        if (response.ok) {
          const servedAppointment: QueueAppointment = await response.json().then((data) => data.appointment || {});
          const startTimeNow = servedAppointment.serving_started_at
            ? new Date(servedAppointment.serving_started_at)
            : new Date();
          setCurrentServing({
            patientName: patient.name,
            token: patient.token,
            position: 1,
            phone: patient.phone,
            patient_id: patient.patient_id,
            patient_email: patient.patient_email,
            blood_group: patient.blood_group,
            doctor_delay: patient.doctor_delay,
            estimated_wait_minutes: patient.estimated_wait_minutes,
            latest_estimated_wait_minutes: patient.latest_estimated_wait_minutes,
            earliest_eta: patient.earliest_eta,
            predicted_eta: patient.predicted_eta,
            latest_eta: patient.latest_eta,
            rolling_average_minutes: patient.rolling_average_minutes,
            consultation_window: patient.consultation_window,
            estimated_window_text: patient.estimated_window_text,
            active_delay_minutes: patient.active_delay_minutes,
            queue_adjusted_time: patient.queue_adjusted_time,
            session_status: patient.session_status,
            startTime: startTimeNow, // Start timer NOW when clicking Next
            appointmentId: patient.appointment_id,
            clinicId: patient.clinic_id,
            doctor_id: patient.doctor_id,
            source: patient.source,
          });

          // Remove from queue
          setQueue(prev => prev.slice(1));

          // Refresh queue data but preserve the start time we just set
          setTimeout(() => {
            fetchQueueForClinic(patient.clinic_id, viewingSlotId, startTimeNow, patient.doctor_id);
          }, 500);
        }
      } catch (error) {
        console.error("Error serving patient:", error);
      }
    }
  }, [queue, viewingSlotId, fetchQueueForClinic]);

  const completePatient = useCallback(async () => {
    if (currentServing && currentServing.appointmentId) {
      try {
        const response = await fetch(`${API_BASE}/auth/clinic/finish-patient`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: currentServing.clinicId,
            appointment_id: currentServing.appointmentId,
            source: currentServing.source || "online"
          })
        });

        if (response.ok) {
          await fetchQueueForClinic(currentServing.clinicId || "", viewingSlotId, undefined, currentServing.doctor_id);
        }
      } catch (error) {
        console.error("Error completing patient:", error);
      }
    }
  }, [currentServing, viewingSlotId, fetchQueueForClinic]);

  const skipPatient = useCallback(async () => {
    if (queue.length > 0) {
      const patient = queue[0];
      try {
        const response = await fetch(`${API_BASE}/auth/clinic/skip-patient`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: patient.clinic_id,
            appointment_id: patient.appointment_id,
            source: patient.source,
          }),
        });

        if (response.ok) {
          // Preserve the current start time when refreshing
          await fetchQueueForClinic(patient.clinic_id, viewingSlotId, currentServing?.startTime, patient.doctor_id);
        }
      } catch (error) {
        console.error("Error skipping patient:", error);
      }
    }
  }, [queue, viewingSlotId, currentServing, fetchQueueForClinic]);

  const addPatient = useCallback(
    (name: string, source: "online" | "desk") => {
      const newToken = `T-${totalToday + 1}`;
      const newPatient: QueueItem = {
        token: newToken,
        name,
        source,
        clinic_id: "",
      };
      setQueue((prev) => [...prev, newPatient]);
      setTotalToday((prev) => prev + 1);
    },
    [totalToday]
  );

  const resetQueue = useCallback(() => {
    setQueue([]);
    setCurrentToken(0);
    setCompletedCount(0);
    setSkippedCount(0);
    setTotalToday(0);
    setCurrentServing(null);
  }, []);

  return (
    <QueueContext.Provider
      value={{
        queue,
        currentToken,
        queueStats,
        completedCount,
        skippedCount,
        totalToday,
        currentServing,
        activeSlotId,
        viewingSlotId,
        nextPatient,
        completePatient,
        skipPatient,
        addWalkinToQueue,
        fetchQueueStats,
        fetchQueueForClinic,
        addPatient,
        resetQueue,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
};
