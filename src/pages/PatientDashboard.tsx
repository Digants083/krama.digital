import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import {
  Hash,
  CalendarPlus,
  ChevronRight,
  Clock,
  MapPin,
  Star,
  User,
} from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { formatDurationMinutes } from "@/lib/timeFormat";

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
        } else if (typeof userStr === 'string' && userStr.includes('@')) {
          // Handle case where user is stored as plain email string
          setPatientEmail(userStr);
          fetchAppointments(userStr);
        } else {
          setLoading(false);
        }
      } catch (e) {
        // Handle corrupted data - clear and redirect to login
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

  const patientName = profile.name?.trim() || "Patient";
  const nextAppointment = appointments[0] || null;
  const appointmentCountText = `${appointments.length} active ${appointments.length === 1 ? "booking" : "bookings"}`;
  const visitTimeText = nextAppointment
    ? [nextAppointment.date, nextAppointment.time].filter(Boolean).join(" at ")
    : "Book your next clinic visit";
  const waitText = nextAppointment?.consultation_window || nextAppointment?.estimated_window_text || "Track token status live";
  const delayText = nextAppointment?.active_delay_minutes
    ? `Delay ${formatDurationMinutes(nextAppointment.active_delay_minutes)}`
    : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-8 lg:py-10">
        <section className="overflow-hidden rounded-[26px] bg-primary text-primary-foreground shadow-[0_22px_60px_-34px_rgba(31,92,84,0.9)] sm:rounded-[32px]">
          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
            <div className="flex min-w-0 flex-col justify-between gap-8">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-foreground/70">Patient Dashboard</p>
                  <h1 className="mt-3 truncate font-display text-3xl font-bold tracking-tight text-white sm:text-5xl">
                    Hi, {patientName}
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-primary-foreground/80 sm:text-base">
                    Book visits, check your token, and keep feedback in one clean place.
                  </p>
                </div>

                <Link
                  to="/patient/profile"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/12 transition hover:bg-white/20"
                  aria-label="Profile"
                >
                  <User className="h-5 w-5" />
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-[18px] bg-white/10 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/65">Bookings</p>
                  <p className="mt-1 text-lg font-bold text-white">{appointmentCountText}</p>
                </div>
                <div className="rounded-[18px] bg-white/10 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/65">Next Visit</p>
                  <p className="mt-1 truncate text-lg font-bold text-white">{nextAppointment ? nextAppointment.appointment_token : "Ready"}</p>
                </div>
                <div className="col-span-2 rounded-[18px] bg-white/10 px-4 py-3 sm:col-span-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/65">Status</p>
                  <p className="mt-1 truncate text-lg font-bold text-white">{nextAppointment?.status || "No queue"}</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => (nextAppointment ? handleAppointmentClick(nextAppointment) : navigate("/patient/find-clinics"))}
              className="rounded-[24px] border border-white/14 bg-white px-5 py-5 text-left text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Next Appointment</p>
                  <h2 className="mt-3 text-2xl font-bold leading-tight">
                    {nextAppointment ? nextAppointment.clinic_name : "Find a clinic near you"}
                  </h2>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f4ef] text-primary">
                  <ChevronRight className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-5 space-y-3 text-sm text-slate-600">
                <p className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-slate-900">{visitTimeText}</span>
                </p>
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{nextAppointment?.address || waitText}</span>
                </p>
                {delayText ? <p className="rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800">{delayText}</p> : null}
              </div>
            </button>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-[#ded6cc] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Quick Actions</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">What do you want to do?</h2>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <Link
                to="/patient/find-clinics"
                className="group flex items-center gap-4 rounded-[18px] border border-[#dbe5e1] bg-[#f8fbfa] p-4 transition hover:border-primary/40 hover:bg-[#eef8f4]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white">
                  <CalendarPlus className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-slate-950">New Appointment</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">Search clinics and book a token.</span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>

              <button
                type="button"
                onClick={() => (nextAppointment ? handleAppointmentClick(nextAppointment) : navigate("/confirmation"))}
                className="group flex items-center gap-4 rounded-[18px] border border-[#dbe5e1] bg-[#f8fbfa] p-4 text-left transition hover:border-primary/40 hover:bg-[#eef8f4]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#102033] text-white">
                  <Hash className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-slate-950">Booked Appointment</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">
                    {nextAppointment ? `Token ${nextAppointment.appointment_token}` : "Open your booking details."}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>

              <Link
                to="/patient/reviews"
                className="group flex items-center gap-4 rounded-[18px] border border-[#dbe5e1] bg-[#f8fbfa] p-4 transition hover:border-primary/40 hover:bg-[#eef8f4]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ffc247] text-slate-950">
                  <Star className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-slate-950">Write Feedback</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-500">Share your clinic experience.</span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#ded6cc] bg-white p-4 shadow-sm sm:p-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Visit Summary</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">Your clinic flow</h2>

            <div className="mt-5 space-y-3">
              <div className="rounded-[18px] bg-[#f6f3ee] p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Appointment</p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {nextAppointment ? `${nextAppointment.doctor_name || "Doctor"} at ${nextAppointment.clinic_name}` : "No active appointment"}
                </p>
                <p className="mt-1 text-sm text-slate-500">{visitTimeText}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[18px] border border-[#e2ddd5] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Token</p>
                  <p className="mt-2 text-2xl font-black text-primary">{nextAppointment?.appointment_token || "-"}</p>
                </div>
                <div className="rounded-[18px] border border-[#e2ddd5] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Queue</p>
                  <p className="mt-2 truncate text-lg font-black text-slate-950">{nextAppointment?.status || "Ready"}</p>
                </div>
              </div>

              <p className="rounded-[18px] bg-[#eaf7f3] px-4 py-3 text-sm font-semibold leading-5 text-primary">
                {nextAppointment ? waitText : "Start with New Appointment when you are ready to visit a clinic."}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PatientDashboard;
