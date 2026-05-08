import { useState } from "react";
import { Clock, Building2, UserCheck, Search } from "lucide-react";
import { apiUrl } from "@/lib/api";

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
  now_serving_token?: string;
  status: string;
  source: string;
}

interface LookupResponse {
  count: number;
  appointments: AppointmentDetails[];
}

const AppointmentCard = ({ appointment }: { appointment: AppointmentDetails }) => {
  const patientsAhead = appointment.patients_ahead ?? 0;
  const estimatedWait = appointment.estimated_wait_minutes ?? 0;
  const nowServing = appointment.now_serving_token || appointment.token_label;
  const positionText = appointment.position ? appointment.position.replace("/", " / ") : "1 / 1";

  return (
    <div className="rounded-3xl border border-primary/10 bg-white p-5 shadow-[0_18px_60px_-38px_rgba(19,55,50,0.55)]">
      <div className="rounded-[28px] bg-primary p-7 text-primary-foreground shadow-[0_28px_80px_-40px_rgba(31,92,84,0.9)]">
        <p className="text-sm uppercase tracking-[0.28em] text-primary-foreground/70">Your Token</p>
        <p className="mt-4 font-display text-6xl font-bold tracking-tight">{appointment.token_label}</p>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-[24px] bg-white/10 p-5">
            <p className="text-sm text-primary-foreground/70">Now serving</p>
            <p className="mt-3 text-3xl font-bold">{nowServing}</p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-5">
            <p className="text-sm text-primary-foreground/70">Estimated wait</p>
            <p className="mt-3 text-3xl font-bold">{estimatedWait} min</p>
          </div>
        </div>

        <div className="mt-4 rounded-[24px] bg-white/10 p-5">
          <p className="text-sm text-primary-foreground/70">Patients ahead</p>
          <p className="mt-3 text-3xl font-bold">{patientsAhead}</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <DetailRow icon={Building2} label="Clinic" value={appointment.clinic_name} subvalue={appointment.clinic_address} />
        <DetailRow icon={UserCheck} label="Doctor" value={appointment.doctor_name || "Available Doctor"} />
        <DetailRow icon={Clock} label="Appointment" value={`${appointment.date} at ${appointment.time}`} />
        <div className="grid grid-cols-2 gap-4 rounded-[20px] border border-primary/10 bg-primary/5 p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Token</p>
            <p className="mt-1 text-lg font-bold text-foreground">{appointment.token_label}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Position</p>
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

  const phoneRegex = /^[6-9]\d{9}$/;

  const handleLookup = async () => {
    if (!phoneRegex.test(phone.trim())) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(apiUrl(`/api/auth/queue/lookup-by-phone?phone=${encodeURIComponent(phone.trim())}`));
      
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "No appointment found for this number");
      }

      const data: LookupResponse = await response.json();
      setAppointments(data.appointments);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      setAppointments(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setPhone("");
    setAppointments(null);
    setError("");
  };

  // Show appointment details (supports multiple appointments)
  if (appointments && appointments.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-primary/10 bg-white p-6 shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Search className="h-5 w-5" />
          </div>
          <h1 className="mb-2 text-center text-xl font-semibold text-foreground">
            Your Details
          </h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            {appointments.length > 1 
              ? `Found ${appointments.length} appointments` 
              : "Here's your appointment information"}
          </p>

          <div className="space-y-4">
            {appointments.map((apt, idx) => (
              <AppointmentCard key={idx} appointment={apt} />
            ))}
          </div>

          <button
            onClick={handleReset}
            className="mt-6 w-full rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-all duration-200 hover:border-primary/40 hover:bg-primary/10"
          >
            Look Up Another Number
          </button>
        </div>
      </div>
    );
  }

  // Phone input form
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Search className="h-6 w-6" />
        </div>
        <h1 className="mb-2 text-center text-xl font-semibold text-foreground">
          Your Details
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Enter your phone number to view your appointment details
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
              className="w-full rounded-lg border border-primary/20 bg-white px-4 py-3 text-sm text-foreground transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {phone.length > 0 && !phoneRegex.test(phone) && (
              <p className="text-xs text-red-500 mt-1">Enter a valid 10-digit mobile number</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={handleLookup}
          disabled={!phoneRegex.test(phone) || loading}
          className="mt-6 w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-[0_14px_28px_-18px_rgba(31,92,84,0.9)] transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
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
            "View Details"
          )}
        </button>
      </div>
    </div>
  );
};

export default YourDetails;
