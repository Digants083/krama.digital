import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import {
  Hash,
  CalendarCheck,
  Star,
  User,
} from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";

type Appointment = {
  id: number;
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
    const timer = window.setInterval(() => void fetchAppointments(patientEmail), 30000);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      <main className="section-container px-4 py-6 md:px-8 md:py-10">
        <section className="rounded-[24px] bg-primary px-4 py-6 text-primary-foreground shadow-[0_24px_70px_-36px_rgba(31,92,84,0.9)] sm:rounded-[32px] sm:px-6 sm:py-8 md:px-8">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-primary-foreground/70 sm:text-sm sm:tracking-[0.22em]">Patient Dashboard</p>
              <h1 className="mt-2 truncate font-display text-3xl font-bold tracking-tight sm:mt-3 sm:text-4xl md:text-5xl">{profile.name}</h1>
              <p className="mt-2 text-sm text-primary-foreground/78 sm:mt-3 sm:text-base">
                {appointments.length > 0 ? "Your appointments are confirmed." : "Book a clinic visit and track it here."}
              </p>
            </div>

            <Link
              to="/patient/profile"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 sm:h-12 sm:w-12"
              aria-label="Profile"
            >
              <User className="h-5 w-5" />
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-3 sm:gap-4">
            <Link
              to="/patient/find-clinics"
              className="rounded-[18px] bg-white/10 px-3 py-4 text-center transition hover:bg-white/20 sm:rounded-[22px] sm:px-6 sm:py-6"
            >
              <CalendarCheck className="mx-auto h-6 w-6 sm:h-8 sm:w-8" />
              <p className="mt-2 text-xs text-primary-foreground/70 sm:text-sm">Book</p>
              <p className="mt-1 text-sm font-bold leading-tight text-white sm:text-xl">New Appointment</p>
            </Link>
            {appointments.length > 0 ? (
              <Link
                to="/confirmation"
                state={{
                  token: appointments[0].appointment_token,
                  clinic: appointments[0].clinic_name,
                  doctor: appointments[0].doctor_name,
                  date: appointments[0].date,
                  time: appointments[0].time,
                  sessionName: appointments[0].session_name,
                  sessionTime: appointments[0].session_time,
                  sessionId: appointments[0].session_id,
                  address: appointments[0].address || "",
                  consultation_window: appointments[0].consultation_window,
                  estimated_window_text: appointments[0].estimated_window_text,
                  estimated_wait_minutes: appointments[0].estimated_wait_minutes,
                  earliest_eta: appointments[0].earliest_eta,
                  predicted_eta: appointments[0].predicted_eta,
                  latest_eta: appointments[0].latest_eta,
                }}
                className="rounded-[18px] bg-white/10 px-3 py-4 text-center transition hover:bg-white/20 sm:rounded-[22px] sm:px-6 sm:py-6"
              >
                <Hash className="mx-auto h-6 w-6 sm:h-8 sm:w-8" />
                <p className="mt-2 text-xs text-primary-foreground/70 sm:text-sm">Appointment</p>
                <p className="mt-1 text-sm font-bold leading-tight text-white sm:text-xl">{appointments[0].appointment_token}</p>
                {(appointments[0].consultation_window || appointments[0].estimated_window_text) && (
                  <p className="mt-1 text-[11px] font-semibold leading-tight text-white/80">
                    {appointments[0].consultation_window || appointments[0].estimated_window_text}
                  </p>
                )}
                {appointments[0].active_delay_minutes ? (
                  <p className="mt-1 text-[11px] font-semibold leading-tight text-[#ffd999]">
                    Delay {appointments[0].active_delay_minutes} min
                  </p>
                ) : null}
              </Link>
            ) : (
              <Link
                to="/confirmation"
                className="rounded-[18px] bg-white/10 px-3 py-4 text-center transition hover:bg-white/20 sm:rounded-[22px] sm:px-6 sm:py-6"
              >
                <Hash className="mx-auto h-6 w-6 sm:h-8 sm:w-8" />
                <p className="mt-2 text-xs text-primary-foreground/70 sm:text-sm">Appointment</p>
                <p className="mt-1 text-sm font-bold leading-tight text-white sm:text-xl">Booked Appointment</p>
              </Link>
            )}
            <Link
              to="/patient/reviews"
              className="rounded-[18px] bg-white/10 px-3 py-4 text-center transition hover:bg-white/20 sm:rounded-[22px] sm:px-6 sm:py-6"
            >
              <Star className="mx-auto h-6 w-6 sm:h-8 sm:w-8" />
              <p className="mt-2 text-xs text-primary-foreground/70 sm:text-sm">Review</p>
              <p className="mt-1 text-sm font-bold leading-tight text-white sm:text-xl">Write Feedback</p>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default PatientDashboard;
