import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Building2, UserCheck, Search, Smartphone, Ticket } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { formatDurationMinutes, formatIsoClock } from "@/lib/timeFormat";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";

interface AppointmentDetails {
  token_label: string;
  patient_name: string;
  clinic_name: string;
  clinic_address?: string;
  doctor_name?: string;
  date: string;
  time: string;
  slot_name?: string;
  position: string;
  patients_ahead: number;
  estimated_wait_minutes: number;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  active_delay_minutes?: number | null;
  queue_position?: number | null;
  session_status?: string | null;
  now_serving_token?: string;
  doctor_delay?: string | null;
  clinic_id?: string;
  delay_minutes?: number;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  status: string;
  source: string;
}

interface LookupResponse {
  count: number;
  appointments: AppointmentDetails[];
}

const phoneRegex = /^[6-9]\d{9}$/;

const AppointmentCard = ({ appointment }: { appointment: AppointmentDetails }) => {
  const patientsAhead = appointment.patients_ahead ?? 0;
  const estimatedWait = appointment.estimated_wait_minutes ?? 0;
  const consultationWindow = appointment.consultation_window || appointment.estimated_window_text || "";
  const predictedConsultationTime = formatIsoClock(appointment.predicted_eta);
  const activeDelayMinutes = appointment.active_delay_minutes || appointment.delay_minutes || 0;
  const hasActiveDelay = Boolean(appointment.doctor_delay || activeDelayMinutes > 0);
  const delayAmountText = activeDelayMinutes > 0 ? `+${formatDurationMinutes(activeDelayMinutes)}` : appointment.doctor_delay;
  const nowServing = appointment.now_serving_token || appointment.token_label;
  const positionText = appointment.position ? appointment.position.replace("/", " / ") : "1 / 1";
  const appointmentTime = appointment.time.replace(/^(time|session)\s*\d+\s*/i, "").trim();

  return (
    <div className="rounded-[30px] border border-white/70 bg-white/85 p-4 shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur">
      <div className="motion-shimmer rounded-[28px] bg-[#143b34] p-5 text-white shadow-[0_28px_80px_-42px_rgba(31,92,84,0.95)] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-white/60">Your Token</p>
            <p className="mt-3 font-display text-6xl font-black tracking-tight">{appointment.token_label}</p>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold capitalize text-white/80">{appointment.status}</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-[20px] bg-white/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Now serving</p>
            <p className="mt-2 text-2xl font-black">{nowServing}</p>
          </div>
          <div className="rounded-[20px] bg-white/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Estimated wait</p>
            <p className="mt-2 text-2xl font-black">{formatDurationMinutes(estimatedWait)}</p>
          </div>
        </div>

        <div className="mt-3 rounded-[20px] bg-[#f6f1e8] p-4 text-[#17312d]">
          <p className="text-xs font-black uppercase tracking-wide text-[#00555A]/75">Estimated consultation window</p>
          <p className="mt-2 text-xl font-black leading-tight">{consultationWindow || "Calculating..."}</p>
          {predictedConsultationTime && (
            <p className="mt-1 text-xs font-bold text-[#00555A]">Predicted time: {predictedConsultationTime}</p>
          )}
        </div>

        <div className={`mt-3 grid gap-3 ${hasActiveDelay ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="rounded-[20px] bg-white/10 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Patients ahead</p>
            <p className="mt-2 text-2xl font-black">{patientsAhead}</p>
          </div>
          {hasActiveDelay && (
            <div className="rounded-[20px] bg-[#ffc247] p-4 text-[#17312d]">
              <p className="text-xs font-black uppercase tracking-wide text-[#17312d]/60">Delay added</p>
              <p className="mt-2 text-2xl font-black">{delayAmountText}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <DetailRow icon={Building2} label="Clinic" value={appointment.clinic_name} subvalue={appointment.clinic_address} />
        <DetailRow icon={UserCheck} label="Doctor" value={appointment.doctor_name || "Available Doctor"} />
        <DetailRow
          icon={Clock}
          label="Appointment"
          value={appointment.date}
          subvalue={appointment.delay_original_start_time && appointment.delay_updated_start_time
            ? `${appointment.delay_original_start_time} -> ${appointment.delay_updated_start_time}`
            : appointmentTime}
        />
        <div className="grid grid-cols-2 gap-3 rounded-[20px] border border-[#eadfce] bg-[#fbfaf7] p-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Token</p>
            <p className="mt-1 text-lg font-bold text-foreground">{appointment.token_label}</p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Position</p>
            <p className="mt-1 text-lg font-bold text-foreground">{positionText}</p>
          </div>
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
  icon: any;
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

const YourDetails = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [appointments, setAppointments] = useState<AppointmentDetails[] | null>(null);
  const lastDelayNotificationRef = useRef<string>("");
  const realtimeClinicId = appointments?.[0]?.clinic_id || null;

  const handleLookup = useCallback(async (showLoading = true) => {
    const lookupPhone = phone.trim();
    if (!phoneRegex.test(lookupPhone)) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }

    if (showLoading) setLoading(true);
    setError("");

    try {
      const lookupUrl = apiUrl(`/api/auth/queue/lookup-by-phone?phone=${encodeURIComponent(lookupPhone)}`);
      console.info("[YourDetails] lookup request", {
        url: lookupUrl,
        phoneLast4: phone.trim().slice(-4),
      });

      const response = await fetch(lookupUrl);
      
      const responseText = await response.text();
      let responseBody: any = {};
      try {
        responseBody = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseBody = { raw: responseText };
      }

      if (!response.ok) {
        console.error("[YourDetails] lookup failed", {
          url: lookupUrl,
          status: response.status,
          statusText: response.statusText,
          response: responseBody,
          rawText: responseText,
        });
        const detail = responseBody.detail;
        const message =
          typeof detail === "string"
            ? detail
            : detail?.message || responseBody.raw || "No appointment found for this number";
        throw new Error(message);
      }

      const data: LookupResponse = responseBody;
      const delayKey = (data.appointments || [])
        .map((apt) => `${apt.token_label}:${apt.delay_ends_at || ""}`)
        .join("|");
      if (
        delayKey &&
        delayKey !== lastDelayNotificationRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        data.appointments?.some((apt) => apt.doctor_delay)
      ) {
        new Notification("Your appointment has been delayed", {
          body: "Open your token for the updated time.",
        });
      }
      lastDelayNotificationRef.current = delayKey;
      console.info("[YourDetails] lookup success", {
        url: lookupUrl,
        count: data.count,
        appointments: data.appointments?.map((apt) => ({
          token: apt.token_label,
          source: apt.source,
          date: apt.date,
          status: apt.status,
          clinic: apt.clinic_name,
        })),
      });
      setAppointments(data.appointments);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      console.error("[YourDetails] lookup exception", err);
      setError(errorMessage);
      setAppointments(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [phone]);

  useEffect(() => {
    if (!appointments || appointments.length === 0 || !phoneRegex.test(phone)) return;
    const timer = window.setInterval(() => {
      void handleLookup(false);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [appointments, handleLookup, phone]);

  useQueueRealtime(realtimeClinicId, () => void handleLookup(false));

  const handleReset = () => {
    setPhone("");
    setAppointments(null);
    setError("");
  };

  // Show appointment details (supports multiple appointments)
  if (appointments && appointments.length > 0) {
    return (
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
        <div className="motion-rise w-full max-w-md rounded-[32px] border border-white/70 bg-white/80 p-4 shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur sm:p-5">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
            <Ticket className="h-5 w-5" />
          </div>
          <h1 className="mb-2 text-center font-display text-2xl font-black text-[#17312d]">
            Your Token
          </h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            {appointments.length > 1 
              ? `Found ${appointments.length} appointments` 
              : "Here's your token information"}
          </p>

          <div className="space-y-4">
            {appointments.map((apt, idx) => (
              <AppointmentCard key={idx} appointment={apt} />
            ))}
          </div>

          <button
            onClick={handleReset}
            className="mt-6 w-full rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm font-bold text-primary transition-all duration-200 hover:border-primary/40 hover:bg-primary/10"
          >
            Look Up Another Number
          </button>
        </div>
      </div>
    );
  }

  // Phone input form
  return (
    <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
      <div className="motion-rise w-full max-w-sm rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur sm:p-6">
        <div className="motion-breathe mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#143b34] text-white shadow-[0_18px_48px_-32px_rgba(31,92,84,0.9)]">
          <Smartphone className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-center font-display text-2xl font-black text-[#17312d]">
          Your Token
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Enter your phone number to view your token details
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-primary">
              Mobile number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile number"
              type="tel"
              inputMode="numeric"
              className="w-full rounded-2xl border border-primary/15 bg-[#fbfaf7] px-4 py-3 text-sm font-semibold text-foreground transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {phone.length > 0 && !phoneRegex.test(phone) && (
              <p className="text-xs text-red-500 mt-1">Enter a valid 10-digit mobile number</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={() => handleLookup()}
          disabled={!phoneRegex.test(phone) || loading}
          className="mt-6 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground shadow-[0_14px_28px_-18px_rgba(31,92,84,0.9)] transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Looking up...
            </span>
          ) : (
            "View Token"
          )}
        </button>
      </div>
    </div>
  );
};

export default YourDetails;
