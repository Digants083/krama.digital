import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import {
  CalendarPlus,
  ChevronRight,
  Clock,
  ClipboardList,
  FileHeart,
  Hash,
  ShieldCheck,
  Star,
  type LucideIcon,
  User,
} from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { formatDurationMinutes, formatIsoClock, formatTimeRange } from "@/lib/timeFormat";

type Appointment = {
  id: number;
  clinic_id?: string;
  clinic_name: string;
  doctor_name: string;
  appointment_token: string;
  date: string;
  time: string;
  status: string;
  session_id?: number;
  session_name?: string;
  session_time?: string;
  address?: string;
  consultation_window?: string | null;
  estimated_window_text?: string | null;
  estimated_wait_minutes?: number | null;
  earliest_eta?: string | null;
  predicted_eta?: string | null;
  latest_eta?: string | null;
  active_delay_minutes?: number | null;
  session_status?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};

const formatBookedDate = (date?: string | null) => {
  if (!date) return "Not set";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const cleanSessionTimeLabel = (time?: string | null) =>
  time?.replace(/^(time|session)\s*\d+\s*/i, "").trim() || "";

const parseSessionTimeRange = (sessionTime?: string | null) => {
  if (!sessionTime) return "";
  try {
    const range = JSON.parse(sessionTime.replace(/'/g, '"'));
    if (Array.isArray(range) && range.length >= 2) {
      return formatTimeRange(range.map(Number));
    }
  } catch {
    // Fall back to the raw session label below.
  }
  return "";
};

const PatientDashboard = () => {
  const navigate = useNavigate();
  const { profile } = usePatient();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientEmail, setPatientEmail] = useState("");
  const realtimeClinicId = appointments[0]?.clinic_id || null;

  const fetchAppointments = useCallback(async (patientEmail: string) => {
    try {
      const response = await fetch(`/api/auth/patient/appointments?email=${encodeURIComponent(patientEmail)}`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      }
    } catch (error) {
      console.error("Failed to fetch appointments:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useQueueRealtime(realtimeClinicId, () => {
    if (patientEmail) void fetchAppointments(patientEmail);
  });

  useEffect(() => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user.email) {
          setPatientEmail(user.email);
          fetchAppointments(user.email);
        } else if (typeof userStr === "string" && userStr.includes("@")) {
          setPatientEmail(userStr);
          fetchAppointments(userStr);
        } else {
          setLoading(false);
        }
      } catch (e) {
        localStorage.removeItem("user");
        localStorage.removeItem("patient_email");
        localStorage.removeItem("patientData");
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, [fetchAppointments]);

  useEffect(() => {
    if (!patientEmail) return;
    const timer = window.setInterval(() => void fetchAppointments(patientEmail), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [fetchAppointments, patientEmail]);

  const handleAppointmentClick = (apt: Appointment) => {
    navigate("/confirmation", {
      state: {
        token: apt.appointment_token,
        clinic: apt.clinic_name,
        doctor: apt.doctor_name,
        date: apt.date,
        time: apt.time,
        sessionName: apt.session_name,
        sessionTime: apt.session_time,
        sessionId: apt.session_id,
        address: apt.address || "",
        consultation_window: apt.consultation_window,
        estimated_window_text: apt.estimated_window_text,
        estimated_wait_minutes: apt.estimated_wait_minutes,
        earliest_eta: apt.earliest_eta,
        predicted_eta: apt.predicted_eta,
        latest_eta: apt.latest_eta,
      },
    });
  };

  const storedPatientData = (() => {
    try {
      return JSON.parse(localStorage.getItem("patientData") || "{}");
    } catch {
      return {};
    }
  })();
  const storedUserData = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  })();
  const patientName =
    (profile.name && profile.name !== "Patient" ? profile.name.trim() : "") ||
    storedPatientData.name?.trim?.() ||
    storedUserData.name?.trim?.() ||
    "Patient";
  const nextAppointment = appointments[0] || null;
  const bookedDateText = nextAppointment ? formatBookedDate(nextAppointment.date) : "No appointment booked yet";
  const sessionSlotText =
    parseSessionTimeRange(nextAppointment?.session_time) ||
    cleanSessionTimeLabel(nextAppointment?.time) ||
    "Session time pending";
  const estimatedTimeText =
    nextAppointment?.consultation_window ||
    nextAppointment?.estimated_window_text ||
    (nextAppointment?.predicted_eta ? formatIsoClock(nextAppointment.predicted_eta) : "") ||
    "Live queue updates will appear here.";
  const activeDelayMinutes = nextAppointment?.active_delay_minutes ?? 0;
  const delayText = activeDelayMinutes > 0 ? `Delay ${formatDurationMinutes(activeDelayMinutes)}` : null;
  const tokenText = nextAppointment?.appointment_token || "--";
  const statusText = nextAppointment?.status || "Ready";
  const fourSections = [
    {
      title: "Book appointment",
      text: "Find a clinic and get a token.",
      icon: CalendarPlus,
      to: "/patient/find-clinics",
      tone: "bg-primary text-white",
    },
    {
      title: "See appointment",
      text: nextAppointment ? "Open your token details." : "No appointment yet.",
      icon: ClipboardList,
      onClick: nextAppointment ? () => handleAppointmentClick(nextAppointment) : undefined,
      tone: "bg-[#f6f1e8] text-primary",
      disabled: !nextAppointment,
    },
    {
      title: "Review",
      text: "Share clinic feedback.",
      icon: Star,
      to: "/patient/reviews",
      tone: "bg-[#ffc247] text-slate-950",
    },
    {
      title: "ABDM & records",
      text: "Connect ABHA or upload reports.",
      icon: ShieldCheck,
      to: "/patient/health-records",
      tone: "bg-[#dceeff] text-[#174b7a]",
    },
    {
      title: "Your summary",
      text: "See every clinic visit in one place.",
      icon: FileHeart,
      to: "/patient/health-summary",
      tone: "bg-[#e1f5ee] text-[#1a5c4a]",
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f4ef]">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <header className="motion-rise flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Patient</p>
            <h1 className="mt-1 truncate font-display text-3xl font-bold text-[#17312d]">{patientName}</h1>
          </div>
          <Link
            to="/patient/profile"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-primary shadow-[0_16px_38px_-28px_rgba(19,55,50,0.7)]"
            aria-label="Profile"
          >
            <User className="h-5 w-5" />
          </Link>
        </header>

        <section className="motion-rise-delayed motion-shimmer overflow-hidden rounded-[30px] bg-[#143b34] p-4 text-white shadow-[0_26px_70px_-42px_rgba(31,92,84,0.95)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Appointment</p>
              <h2 className="mt-2 truncate text-lg font-bold">
                {nextAppointment ? nextAppointment.clinic_name : "No appointment booked"}
              </h2>
              <p className="mt-1 truncate text-sm text-white/70">
                {nextAppointment ? nextAppointment.doctor_name || "Doctor pending" : "Book one when ready"}
              </p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold capitalize text-white/80">
              {statusText}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <InfoMini icon={Hash} label="Token" value={tokenText} />
            <InfoMini icon={Clock} label="Est time" value={estimatedTimeText} />
            <InfoMini icon={Clock} label="Date" value={bookedDateText} helper={nextAppointment ? sessionSlotText : ""} />
          </div>

          {delayText ? (
            <p className="mt-3 inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-[#17312d]">
              {delayText}
            </p>
          ) : null}
        </section>

        <section className="motion-rise-delayed grid grid-cols-2 gap-3">
          {fourSections.map((item) => (
            <DashboardAction key={item.title} {...item} />
          ))}
        </section>
      </main>
    </div>
  );
};

const InfoMini = ({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper?: string;
}) => (
  <div className="min-w-0 rounded-[18px] bg-[#f6f1e8] p-3 text-[#17312d]">
    <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-primary/75">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
    <p className="mt-2 line-clamp-2 min-h-9 text-sm font-black leading-tight">{value}</p>
    {helper ? <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{helper}</p> : null}
  </div>
);

const DashboardAction = ({
  title,
  text,
  icon: Icon,
  tone,
  to,
  onClick,
  disabled,
}: {
  title: string;
  text: string;
  icon: LucideIcon;
  tone: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
}) => {
  const content = (
    <>
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-4 block text-base font-black text-slate-950">{title}</span>
      <span className="mt-1 block text-sm leading-5 text-slate-500">{text}</span>
      <ChevronRight className="absolute right-3 top-3 h-5 w-5 text-slate-300" />
    </>
  );

  const className =
    "relative min-h-[152px] rounded-[26px] border border-white/70 bg-white/80 p-4 text-left shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur transition active:scale-[0.98] hover:-translate-y-0.5 hover:bg-white";

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${className} ${disabled ? "opacity-65" : ""}`}
    >
      {content}
    </button>
  );
};

export default PatientDashboard;
