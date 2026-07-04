import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePatient } from "@/context/PatientContext";
import { MapPin, Stethoscope, Users } from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { formatDurationMinutes, formatIsoClock } from "@/lib/timeFormat";

interface ConfirmationState {
  clinic: string;
  doctor: string;
  date: string;
  time: string;
  sessionName?: string;
  sessionTime?: string;
  originalSessionTime?: string;
  delay?: string;
  sessionId?: number;
  address: string;
  token: string;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  estimated_wait_minutes?: number | null;
  active_delay_minutes?: number | null;
  doctor_delay?: string | null;
  delay_minutes?: number | null;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  queue_position?: number | null;
  session_status?: string | null;
}

interface AppointmentDetails {
  id: number;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  clinic_id: string;
  clinic_name: string;
  doctor_name: string;
  date: string;
  time: string;
  appointment_token: string;
  status: string;
  slot_id?: number;
  session_id?: number;
  session_name?: string;
  session_time?: string;
  address?: string;
  created_at: string;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  estimated_wait_minutes?: number | null;
  active_delay_minutes?: number | null;
  doctor_delay?: string | null;
  delay_minutes?: number | null;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  queue_position?: number | null;
  session_status?: string | null;
}

interface QueuePosition {
  patients_ahead: number;
  estimated_wait_minutes: number;
  your_position: number;
  total_in_queue: number;
  now_serving_token?: string;
  doctor_delay?: string | null;
  delayed_start_time?: string | null;
  session_id?: number;
  slot_id?: number;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  active_delay_minutes?: number | null;
  delay_minutes?: number | null;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  queue_position?: number | null;
  session_status?: string | null;
}

const LIVE_REFRESH_MS = 5 * 60 * 1000;

const AppointmentConfirmation = () => {
  const { state } = useLocation() as { state: ConfirmationState | null };
  const navigate = useNavigate();
  const { setActiveAppointment, addVisit } = usePatient();
  const [appointmentDetails, setAppointmentDetails] = useState<AppointmentDetails | null>(null);
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);
  const [loading, setLoading] = useState(true);
  const addedVisitTokenRef = useRef<string | null>(null);

  const fetchAppointmentDetails = useCallback(async (cancelledRef?: { current: boolean }) => {
      try {
        const userStr = localStorage.getItem("user");
        if (!userStr) {
          if (!cancelledRef?.current) setLoading(false);
          return;
        }

        const user = JSON.parse(userStr);
        const response = await fetch(
          `/api/auth/patient/appointments?email=${encodeURIComponent(user.email)}`
        );
        if (!response.ok) {
          if (!cancelledRef?.current) setLoading(false);
          return;
        }

        const data = await response.json();
        const allAppointments: AppointmentDetails[] = data.appointments || [];
        
        let selectedAppointment: AppointmentDetails | null = null;
        if (state?.token) {
          selectedAppointment =
            allAppointments.find((appointment) => appointment.appointment_token === state.token) || null;
        }

        // Fall back to most recent appointment (last one in the list).
        if (allAppointments.length > 0) {
          selectedAppointment = selectedAppointment || allAppointments[allAppointments.length - 1];
        }
        
        if (selectedAppointment) {
          if (cancelledRef?.current) return;
          setAppointmentDetails(selectedAppointment);

          const queueParams = new URLSearchParams({
            clinic_id: selectedAppointment.clinic_id,
            appointment_token: selectedAppointment.appointment_token,
            appointment_id: String(selectedAppointment.id),
          });
          const queueResponse = await fetch(`/api/auth/appointments/queue-position?${queueParams}`);
          if (queueResponse.ok) {
            const queueData = await queueResponse.json();
            if (!cancelledRef?.current) setQueuePosition(queueData);
          }
        }
      } catch (error) {
        console.error("Error fetching appointment details:", error);
      } finally {
        if (!cancelledRef?.current) setLoading(false);
      }
    }, [state?.token]);

  useQueueRealtime(appointmentDetails?.clinic_id, () => void fetchAppointmentDetails());

  useEffect(() => {
    const cancelledRef = { current: false };

    void fetchAppointmentDetails(cancelledRef);
    const intervalId = window.setInterval(() => void fetchAppointmentDetails(), LIVE_REFRESH_MS);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(intervalId);
    };
  }, [fetchAppointmentDetails]);

  const token = state?.token || appointmentDetails?.appointment_token || "T-1";
  const clinicName = state?.clinic || appointmentDetails?.clinic_name || "Unknown Clinic";
  const clinicAddress = state?.address || appointmentDetails?.address || "";
  const doctorName = state?.doctor || appointmentDetails?.doctor_name || "Available Doctor";
  const dateText = state?.date || appointmentDetails?.date || "";
  const timeText = state?.time || appointmentDetails?.time || "";
  const patientsAhead = queuePosition?.patients_ahead ?? 0;
  const estimatedWait = queuePosition?.estimated_wait_minutes ?? state?.estimated_wait_minutes ?? appointmentDetails?.estimated_wait_minutes ?? 0;
  const consultationWindow =
    queuePosition?.consultation_window ||
    queuePosition?.estimated_window_text ||
    state?.consultation_window ||
    state?.estimated_window_text ||
    appointmentDetails?.consultation_window ||
    appointmentDetails?.estimated_window_text ||
    "";
  const predictedConsultationTime = formatIsoClock(
    queuePosition?.predicted_eta ||
    state?.predicted_eta ||
    appointmentDetails?.predicted_eta ||
    null
  );
  const nowServing = queuePosition?.now_serving_token || token;
  const activeDelayMinutes = queuePosition?.active_delay_minutes ?? queuePosition?.delay_minutes ?? state?.active_delay_minutes ?? state?.delay_minutes ?? appointmentDetails?.active_delay_minutes ?? appointmentDetails?.delay_minutes ?? 0;
  const delayNotice = queuePosition?.doctor_delay || state?.doctor_delay || appointmentDetails?.doctor_delay || state?.delay || (activeDelayMinutes > 0 ? formatDurationMinutes(activeDelayMinutes) : null);
  const sessionStatusText = queuePosition?.session_status || appointmentDetails?.session_status || state?.session_status || "";
  const hasActiveDelay = Boolean(delayNotice || activeDelayMinutes > 0 || sessionStatusText.toLowerCase() === "delayed");
  const delayAmountText = activeDelayMinutes > 0 ? `+${formatDurationMinutes(activeDelayMinutes)}` : delayNotice || "Delayed";
  const queuePositionText = queuePosition
    ? `${queuePosition.queue_position || queuePosition.your_position} of ${queuePosition.total_in_queue}`
    : null;

  useEffect(() => {
    if (!token || !clinicName || !doctorName || !dateText || !timeText) return;

    setActiveAppointment({
      token,
      clinic: clinicName,
      doctor: doctorName,
      date: dateText,
      time: timeText,
      address: clinicAddress,
      status: appointmentDetails?.status === "serving" ? "with_doctor" : "waiting",
      estimatedWaitMins: estimatedWait,
      patientsAhead,
      consultationWindow,
      earliestEta: queuePosition?.earliest_eta || state?.earliest_eta || appointmentDetails?.earliest_eta || null,
      latestEta: queuePosition?.latest_eta || state?.latest_eta || appointmentDetails?.latest_eta || null,
    });
    if (addedVisitTokenRef.current !== token) {
      addedVisitTokenRef.current = token;
      addVisit({
        clinicId: `clinic-${token}`,
        clinicName,
        date: `${dateText} at ${timeText}`,
      });
    }
  }, [token, clinicName, doctorName, dateText, timeText, clinicAddress, appointmentDetails?.status, estimatedWait, patientsAhead, consultationWindow, queuePosition?.earliest_eta, queuePosition?.latest_eta, state?.earliest_eta, state?.latest_eta, appointmentDetails?.earliest_eta, appointmentDetails?.latest_eta, setActiveAppointment, addVisit]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!state && !appointmentDetails) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">No appointment data found.</p>
          <Button className="mt-4" onClick={() => navigate("/patient")}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f3ef] px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        {/* Token & live queue */}
        <div className="overflow-hidden rounded-[32px] bg-primary shadow-[0_28px_80px_-40px_rgba(31,92,84,0.9)]">
          <div className="px-6 pb-2 pt-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">Your Token</p>
            <p className="mt-2 font-display text-7xl font-bold tracking-tight text-white">{token}</p>
            {queuePositionText && (
              <p className="mt-2 text-sm font-medium text-white/70">Position {queuePositionText}</p>
            )}
          </div>

          <div className="mx-5 mb-5 mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TokenStat label="Now serving" value={nowServing} />
              <TokenStat label="Est. wait" value={formatDurationMinutes(estimatedWait)} />
            </div>

            <div className="rounded-2xl bg-white/10 px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">Consultation window</p>
              <p className="mt-1.5 text-lg font-bold leading-snug text-white">
                {consultationWindow || "Calculating..."}
              </p>
              {predictedConsultationTime && (
                <p className="mt-1 text-sm text-white/75">Around {predictedConsultationTime}</p>
              )}
            </div>

            <div className={`grid gap-3 ${hasActiveDelay ? "grid-cols-2" : "grid-cols-1"}`}>
              <TokenStat label="Patients ahead" value={String(patientsAhead)} icon={Users} />
              {hasActiveDelay && (
                <div className="rounded-2xl bg-amber-400/20 px-4 py-3.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-100/80">Delay</p>
                  <p className="mt-1 text-xl font-bold text-white">{delayAmountText}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Clinic info only */}
        <div className="rounded-[28px] border border-[#e6ded3] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
              <MapPin className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clinic</p>
              <p className="mt-0.5 text-lg font-bold text-foreground">{clinicName}</p>
              {clinicAddress ? (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{clinicAddress}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3 border-t border-border/50 pt-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
              <Stethoscope className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Doctor</p>
              <p className="mt-0.5 font-semibold text-foreground">{doctorName}</p>
            </div>
          </div>
        </div>

        <Button variant="outline" className="h-12 w-full rounded-2xl border-[#e6ded3] bg-white" onClick={() => navigate("/patient")}>
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
};

const TokenStat = ({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Users;
}) => (
  <div className="rounded-2xl bg-white/10 px-4 py-3.5">
    <div className="flex items-center gap-1.5">
      {Icon ? <Icon className="h-3.5 w-3.5 text-white/50" /> : null}
      <p className="text-xs font-medium uppercase tracking-wide text-white/60">{label}</p>
    </div>
    <p className="mt-1 text-2xl font-bold text-white">{value}</p>
  </div>
);

export default AppointmentConfirmation;
