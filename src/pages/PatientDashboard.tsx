import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import {
  CalendarPlus,
  ChevronRight,
  Clock,
  Hash,
  MapPin,
  Star,
  User,
} from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import WaitingRoomIllustration from "@/components/illustrations/WaitingRoomIllustration";
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

const buildClinicMapsUrl = (latitude?: string | null, longitude?: string | null) => {
  const lat = latitude ? Number(latitude) : NaN;
  const lng = longitude ? Number(longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng}&z=17`;
};

const openClinicInGoogleMaps = (latitude?: string | null, longitude?: string | null) => {
  const mapsUrl = buildClinicMapsUrl(latitude, longitude);
  if (!mapsUrl) return;
  window.open(mapsUrl, "_blank", "noopener,noreferrer");
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
  const predictedTimeText = nextAppointment?.predicted_eta ? formatIsoClock(nextAppointment.predicted_eta) : "";
  const activeDelayMinutes = nextAppointment?.active_delay_minutes ?? 0;
  const delayText = activeDelayMinutes > 0 ? `Delay ${formatDurationMinutes(activeDelayMinutes)}` : null;
  const clinicMapsUrl = buildClinicMapsUrl(nextAppointment?.latitude, nextAppointment?.longitude);
  const clinicAddress = nextAppointment?.address?.trim() || "";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f4ef]">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef]">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-8">
        <div className="flex items-start gap-3 sm:block">
          <Link
            to="/patient/profile"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#ded6cc] bg-white text-primary shadow-sm sm:hidden"
            aria-label="Profile"
          >
            <User className="h-5 w-5" />
          </Link>
          <header className="min-w-0 flex-1 rounded-2xl bg-primary px-4 py-4 text-primary-foreground shadow-[0_18px_44px_-34px_rgba(31,92,84,0.9)] sm:flex sm:items-center sm:justify-between sm:gap-4 sm:rounded-3xl sm:px-7 sm:py-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">Patient Dashboard</p>
              <p className="mt-2 text-sm font-medium text-primary-foreground/80">Welcome back</p>
              <h1 className="mt-0.5 break-words font-display text-2xl font-bold tracking-tight text-white sm:truncate sm:text-4xl">
                {patientName}
              </h1>
            </div>

            <Link
              to="/patient/profile"
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/12 transition hover:bg-white/20 sm:inline-flex"
              aria-label="Profile"
            >
              <User className="h-5 w-5" />
            </Link>
          </header>
        </div>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-[#ded6cc] bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Current Appointment</p>
                <h2 className="mt-2 break-words text-2xl font-bold text-slate-950">
                  {nextAppointment ? nextAppointment.clinic_name : "No active appointment"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {nextAppointment ? nextAppointment.doctor_name || "Doctor details pending" : "Book a clinic visit when you are ready."}
                </p>
              </div>

              {nextAppointment ? (
                <button
                  type="button"
                  onClick={() => handleAppointmentClick(nextAppointment)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90 sm:w-auto sm:py-2"
                >
                  View details <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <Link
                  to="/patient/find-clinics"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90 sm:w-auto sm:py-2"
                >
                  Book appointment <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-2xl bg-[#f6f3ee] sm:mt-5">
              <div className="min-w-0 border-r border-[#e5ddd2] p-3 sm:p-4">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary sm:text-[11px]">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Date
                </p>
                <p className="mt-1.5 text-sm font-bold leading-snug text-slate-950 sm:text-base">{bookedDateText}</p>
                {nextAppointment ? (
                  <p className="mt-1 text-[11px] leading-4 text-slate-500 sm:text-sm">{sessionSlotText}</p>
                ) : null}
              </div>

              <div className="min-w-0 border-r border-[#e5ddd2] p-3 sm:p-4">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary sm:text-[11px]">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Est. time
                </p>
                <p className="mt-1.5 text-sm font-bold leading-snug text-slate-950 sm:text-base">{estimatedTimeText}</p>
                {predictedTimeText && predictedTimeText !== estimatedTimeText ? (
                  <p className="mt-1 text-[11px] leading-4 text-primary/80 sm:text-sm">Around {predictedTimeText}</p>
                ) : null}
                {delayText ? (
                  <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800 sm:text-xs">
                    {delayText}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0 p-3 sm:p-4">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary sm:text-[11px]">
                  <Hash className="h-3.5 w-3.5 shrink-0" /> Token
                </p>
                <p className="mt-1.5 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                  {nextAppointment?.appointment_token || "-"}
                </p>
                <p className="mt-1 text-[11px] capitalize leading-4 text-primary/80 sm:text-sm">{nextAppointment?.status || "Ready"}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#e2ddd5] p-3.5 text-sm leading-6 text-slate-600 sm:p-4">
              {clinicAddress ? (
                clinicMapsUrl ? (
                  <button
                    type="button"
                    onClick={() => openClinicInGoogleMaps(nextAppointment?.latitude, nextAppointment?.longitude)}
                    className="group flex w-full items-start gap-3 rounded-xl text-left transition hover:bg-[#f6f3ee]"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-950">{clinicAddress}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">
                        Open in Google Maps
                        <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </span>
                    </span>
                  </button>
                ) : (
                  <p className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{clinicAddress}</span>
                  </p>
                )
              ) : (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>Clinic location will appear here once available.</span>
                </p>
              )}
            </div>
          </div>

          <aside className="rounded-2xl border border-[#ded6cc] bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Actions</p>
            <h2 className="mt-2 text-xl font-bold text-slate-950">What do you need?</h2>

            <div className="mt-5 grid gap-3">
              <Link
                to="/patient/find-clinics"
                className="group flex min-h-20 items-center gap-3 rounded-2xl border border-[#dbe5e1] bg-[#f8fbfa] p-3.5 transition hover:border-primary/40 hover:bg-[#eef8f4] sm:gap-4 sm:p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
                  <CalendarPlus className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950">Book a visit</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">Find clinics and get a token.</span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>

              <Link
                to="/patient/reviews"
                className="group flex min-h-20 items-center gap-3 rounded-2xl border border-[#dbe5e1] bg-[#f8fbfa] p-3.5 transition hover:border-primary/40 hover:bg-[#eef8f4] sm:gap-4 sm:p-4"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ffc247] text-slate-950">
                  <Star className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950">Write feedback</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">Share your clinic experience.</span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
};

export default PatientDashboard;
