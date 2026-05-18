import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePatient } from "@/context/PatientContext";
import { CalendarDays, MapPin, Stethoscope, type LucideIcon } from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";

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
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  estimated_wait_minutes?: number | null;
  active_delay_minutes?: number | null;
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
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  estimated_wait_minutes?: number | null;
  active_delay_minutes?: number | null;
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
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  active_delay_minutes?: number | null;
  queue_position?: number | null;
  session_status?: string | null;
}

const LIVE_REFRESH_MS = 5000;

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
  const displayTimeText = timeText.replace(/^(time|session)\s*\d+\s*/i, "").trim();
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
  const nowServing = queuePosition?.now_serving_token || token;
  const activeDelayMinutes = queuePosition?.active_delay_minutes ?? state?.active_delay_minutes ?? appointmentDetails?.active_delay_minutes ?? 0;
  const delayNotice = queuePosition?.doctor_delay || state?.delay || (activeDelayMinutes > 0 ? `${activeDelayMinutes} min` : null);

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-[36px] bg-primary p-8 text-white shadow-[0_28px_80px_-40px_rgba(31,92,84,0.9)]">
          <p className="text-sm uppercase tracking-[0.28em] text-white/70">Your Token</p>
          <p className="mt-4 font-display text-6xl font-bold tracking-tight">{token}</p>

          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="rounded-[24px] bg-white/10 p-5">
              <p className="text-sm text-white/70">Now serving</p>
              <p className="mt-3 text-3xl font-bold">{nowServing}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-5">
              <p className="text-sm text-white/70">Estimated wait</p>
              <p className="mt-3 text-3xl font-bold">{estimatedWait} min</p>
            </div>
          </div>

          <div className="mt-4 rounded-[24px] bg-white/10 p-5">
            <p className="text-sm text-white/70">Estimated Consultation Window</p>
            <p className="mt-3 text-2xl font-bold leading-tight">{consultationWindow || "Calculating..."}</p>
          </div>

          <div className={`mt-4 grid gap-4 ${delayNotice ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="rounded-[24px] bg-white/10 p-5">
              <p className="text-sm text-white/70">Patients ahead</p>
              <p className="mt-3 text-3xl font-bold">{patientsAhead}</p>
            </div>
            {delayNotice && (
              <div className="rounded-[24px] bg-white/10 p-5">
                <p className="text-sm text-white/70">Delay</p>
                <p className="mt-3 text-3xl font-bold">{delayNotice}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-border/70 bg-white p-6 shadow-sm">
          <div className="space-y-4">
            <DetailRow icon={MapPin} label="Clinic" value={clinicName} subvalue={clinicAddress} />
            <DetailRow icon={Stethoscope} label="Doctor" value={doctorName} />
            <DetailRow icon={CalendarDays} label="Appointment" value={dateText} subvalue={displayTimeText} />
            <div className="grid grid-cols-2 gap-4 rounded-[20px] bg-secondary/60 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Token</p>
                <p className="mt-1 text-lg font-bold text-foreground">{token}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Position</p>
                <p className="mt-1 text-lg font-bold text-foreground">
                  {queuePosition ? `${queuePosition.queue_position || queuePosition.your_position} / ${queuePosition.total_in_queue}` : "1 / 1"}
                </p>
              </div>
            </div>
            <div className="rounded-[20px] bg-secondary/60 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Queue Status</p>
              <p className="mt-1 text-lg font-bold text-foreground">{queuePosition?.session_status || appointmentDetails?.session_status || "Active"}</p>
              {activeDelayMinutes > 0 && <p className="text-sm font-semibold text-orange-700">Doctor delay active: {activeDelayMinutes} min</p>}
            </div>
            <div className="rounded-[20px] bg-primary/5 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated Consultation Window</p>
              <p className="mt-1 text-lg font-bold text-foreground">{consultationWindow || "Calculating..."}</p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Button variant="outline" className="w-full" onClick={() => navigate("/patient")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

const DetailRow = ({
  icon: Icon,
  label,
  value,
  subvalue,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  subvalue?: string;
}) => (
  <div className="flex items-start gap-3">
    <Icon className="mt-0.5 h-5 w-5 text-primary" />
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground">{value}</p>
      {subvalue ? <p className="text-sm text-muted-foreground">{subvalue}</p> : null}
    </div>
  </div>
);

export default AppointmentConfirmation;
