import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePatient } from "@/context/PatientContext";
import { Clock3, MapPin, Stethoscope, Users } from "lucide-react";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#efe6d8] px-4 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(31,92,84,0.18),transparent_26%),radial-gradient(circle_at_82%_20%,rgba(224,164,88,0.22),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.68),rgba(239,230,216,0.74))]" />
      <div className="absolute left-0 top-0 h-full w-full opacity-45 blur-[2px]">
        <div className="absolute left-[5%] top-[19%] h-28 w-20 rounded-t-full bg-[#153d38]/20" />
        <div className="absolute left-[8%] top-[32%] h-32 w-28 rounded-[14px] bg-white/40" />
        <div className="absolute right-[8%] top-[16%] h-36 w-16 rounded-t-full bg-[#1f5c54]/20" />
        <div className="absolute bottom-[12%] right-[12%] h-28 w-36 rounded-[18px] bg-[#133732]/20" />
        <div className="absolute bottom-[15%] left-[12%] h-16 w-40 rounded-[18px] bg-white/30" />
      </div>

      <div className="relative grid w-full max-w-5xl items-center gap-8 md:grid-cols-[minmax(280px,0.86fr)_minmax(300px,1fr)]">
        <div className="mx-auto w-full max-w-[330px] rotate-[-4deg] rounded-[42px] border-[10px] border-[#171b18] bg-[#171b18] shadow-[0_34px_70px_-24px_rgba(20,28,24,0.72)] md:justify-self-end">
          <div className="relative overflow-hidden rounded-[31px] bg-[#1f6a45] px-5 pb-5 pt-7 text-center text-white">
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-white/20" />
            <p className="font-display text-lg font-bold leading-none text-white/90">Your Token</p>
            <p className="mt-1 text-xs font-medium text-white/72">You will be called shortly</p>

            <div className="mt-5 rounded-[16px] bg-[#f6f1e8] px-4 py-5 text-[#1d5b40] shadow-[0_16px_34px_-24px_rgba(0,0,0,0.65)]">
              <p className="font-display text-6xl font-bold leading-none tracking-wide">{token}</p>
              <div className="mt-3 flex items-center justify-center gap-1.5 text-xs font-bold text-[#276348]">
                <Users className="h-3.5 w-3.5" />
                <span>{patientsAhead} {patientsAhead === 1 ? "person" : "people"} ahead of you</span>
              </div>
              {queuePositionText ? (
                <p className="mt-1 text-[11px] font-semibold text-[#64836e]">Position {queuePositionText}</p>
              ) : null}
            </div>

            <div className="mx-4 mt-4 rounded-[10px] bg-[#e6ecd9] px-4 py-3 text-[#265844]">
              <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold">
                <Clock3 className="h-3.5 w-3.5" />
                <span>Estimated waiting time</span>
              </div>
              <p className="mt-1 text-sm font-black">{formatDurationMinutes(estimatedWait)}</p>
              {predictedConsultationTime ? (
                <p className="mt-1 text-[11px] font-semibold text-[#6b826f]">Around {predictedConsultationTime}</p>
              ) : null}
            </div>

            <p className="mt-5 text-xs font-semibold text-white/72">Please wait for your turn.</p>
            <MiniWaitingRoom />
          </div>
        </div>

        <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/50 bg-white/80 p-5 shadow-[0_26px_70px_-42px_rgba(19,49,45,0.65)] backdrop-blur-md">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1f5c54]/70">Appointment confirmed</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-[#17312d]">Keep this token open on your phone.</h1>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <TokenStat label="Now serving" value={nowServing} />
            <TokenStat label="Window" value={consultationWindow || "Calculating"} />
          </div>

          {hasActiveDelay ? (
            <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Delay</p>
              <p className="mt-1 text-lg font-black text-[#17312d]">{delayAmountText}</p>
            </div>
          ) : null}

          <div className="mt-5 space-y-4 border-t border-[#e6ded3] pt-5">
            <InfoRow icon={MapPin} label="Clinic" title={clinicName} detail={clinicAddress} />
            <InfoRow icon={Stethoscope} label="Doctor" title={doctorName} />
          </div>

          <Button variant="outline" className="mt-5 h-12 w-full rounded-[16px] border-[#d8ccbd] bg-white" onClick={() => navigate("/patient")}>
            Back to Dashboard
          </Button>
        </div>
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
  <div className="rounded-[14px] bg-[#f6f1e8] px-4 py-3">
    <div className="flex items-center gap-1.5">
      {Icon ? <Icon className="h-3.5 w-3.5 text-[#1f5c54]/60" /> : null}
      <p className="text-xs font-bold uppercase tracking-wide text-[#6d7d73]">{label}</p>
    </div>
    <p className="mt-1 text-lg font-black leading-tight text-[#17312d]">{value}</p>
  </div>
);

const InfoRow = ({
  icon: Icon,
  label,
  title,
  detail,
}: {
  icon: typeof MapPin;
  label: string;
  title: string;
  detail?: string;
}) => (
  <div className="flex items-start gap-3">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#1f5c54]/10">
      <Icon className="h-5 w-5 text-[#1f5c54]" />
    </span>
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-bold text-[#17312d]">{title}</p>
      {detail ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p> : null}
    </div>
  </div>
);

const MiniWaitingRoom = () => (
  <div className="relative mx-auto mt-5 h-20 w-full max-w-[220px] overflow-hidden rounded-b-[18px] bg-[#e8f0dc]">
    <div className="absolute bottom-0 left-0 right-0 h-5 bg-[#cbd7bd]" />
    <div className="absolute bottom-5 left-5 h-2 w-32 rounded-full bg-[#819b80]/50" />
    <div className="absolute bottom-7 left-4 h-8 w-16 rounded-[8px] bg-[#2f7a62]/30" />
    <div className="absolute bottom-7 left-9 h-10 w-6 rounded-t-full bg-[#17423c]" />
    <div className="absolute bottom-[46px] left-10 h-4 w-4 rounded-full bg-[#d7a16d]" />
    <div className="absolute bottom-7 left-[70px] h-9 w-6 rounded-t-full bg-[#d99b54]" />
    <div className="absolute bottom-[45px] left-[72px] h-4 w-4 rounded-full bg-[#5f3d2b]" />
    <div className="absolute bottom-6 right-10 h-12 w-3 rounded-t-full bg-[#7ea077]" />
    <div className="absolute bottom-6 right-7 h-9 w-3 rounded-t-full bg-[#b8cdb0]" />
    <div className="absolute bottom-5 right-4 h-10 w-5 rounded-t-[10px] bg-[#6f8d74]" />
    <div className="absolute bottom-5 right-[74px] h-14 w-12 rounded-t-full bg-white/30" />
  </div>
);

export default AppointmentConfirmation;
