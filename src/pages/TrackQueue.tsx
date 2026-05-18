import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MapPin, Clock, Building2, UserCheck, Users, Timer } from "lucide-react";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { formatIsoClock } from "@/lib/timeFormat";

interface QueuePosition {
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
  your_position: number;
  total_in_queue: number;
  current_token: number;
  now_serving_token?: string;
}

const TrackQueue = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);
  const [trackingClinicId, setTrackingClinicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const {
    clinic = "CityCare Clinic",
    doctor = "Dr. Ananya Sharma",
    token = "T-454",
    address = "",
    date = "",
    time = "",
  } = state || {};

  const fetchQueuePosition = useCallback(async () => {
    try {
      const userStr = localStorage.getItem("user");
      if (!userStr) return;

      const user = JSON.parse(userStr);
      const response = await fetch(`/api/auth/patient/appointments?email=${encodeURIComponent(user.email)}`);
      if (!response.ok) return;

      const data = await response.json();
      const today = new Date().toISOString().split("T")[0];
      const todayAppointments = (data.appointments || []).filter((apt: any) => apt.date === today);
      if (todayAppointments.length === 0) return;

      const latestAppointment = [...todayAppointments].sort((a: any, b: any) => Number(b.id || 0) - Number(a.id || 0))[0];
      setTrackingClinicId(latestAppointment.clinic_id || null);

      const params = new URLSearchParams({
        clinic_id: latestAppointment.clinic_id,
        appointment_token: latestAppointment.appointment_token,
        appointment_id: String(latestAppointment.id),
      });
      const queueResponse = await fetch(`/api/auth/appointments/queue-position?${params}`);
      if (queueResponse.ok) {
        setQueuePosition(await queueResponse.json());
      }
    } catch (error) {
      console.error("Error fetching queue position:", error);
      setMessage({ text: "Error fetching queue position", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useQueueRealtime(trackingClinicId, fetchQueuePosition);

  useEffect(() => {
    void fetchQueuePosition();
    const interval = setInterval(() => void fetchQueuePosition(), 30000);
    return () => clearInterval(interval);
  }, [fetchQueuePosition]);

  if (loading) {
    return (
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="mt-4 text-gray-600">Loading queue information...</p>
        </div>
      </div>
    );
  }

  const patientsAhead = queuePosition?.patients_ahead ?? 0;
  const estimatedWait = queuePosition?.estimated_wait_minutes ?? 0;
  const consultationWindow = queuePosition?.consultation_window || queuePosition?.estimated_window_text || "";
  const predictedConsultationTime = formatIsoClock(queuePosition?.predicted_eta);
  const activeDelayMinutes = queuePosition?.active_delay_minutes || 0;
  const yourPosition = queuePosition?.your_position ?? 1;
  const totalInQueue = queuePosition?.total_in_queue ?? 1;
  const nowServingNum = (queuePosition?.current_token ?? 1) - 1;
  const nowServing = queuePosition?.now_serving_token || `A-${nowServingNum > 0 ? nowServingNum : 1}`;

  return (
    <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[#0F172A]">Live Queue Tracker</h1>
        <p className="mb-6 text-center text-sm text-gray-600">Watch your turn progress</p>

        <div className="mb-6 rounded-xl bg-[#FFC107] p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-[#0F172A]">Your Token</p>
          <p className="mt-2 font-extrabold leading-none tracking-widest text-[#0F172A] text-5xl">{token}</p>
        </div>

        <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
            <Building2 className="h-4 w-4 text-[#00555A]" />
            Clinic Information
          </h3>
          <div className="space-y-2 text-sm">
            <InfoRow icon={Building2} label="Clinic Name" value={clinic} />
            {address ? <InfoRow icon={MapPin} label="Address" value={address} /> : null}
            <InfoRow icon={UserCheck} label="Doctor" value={doctor} />
            {date && time ? <InfoRow icon={Clock} label="Date & Time" value={`${date} at ${time}`} /> : null}
          </div>
        </div>

        <div className="mb-6 space-y-3 text-sm">
          <MetricRow icon={Users} label="Now Serving:" value={nowServing} highlight />
          <MetricRow icon={Users} label="Patients ahead:" value={String(patientsAhead)} />
          <MetricRow icon={Timer} label="Estimated wait:" value={`${estimatedWait} mins`} />
          {activeDelayMinutes > 0 && (
            <MetricRow icon={Clock} label="Doctor delay:" value={`${activeDelayMinutes} mins`} />
          )}

          <div className="rounded-xl border border-[#00555A]/10 bg-[#00555A]/5 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Estimated Consultation Window</p>
            <p className="mt-1 text-lg font-bold text-[#0F172A]">{consultationWindow || "Calculating..."}</p>
            {predictedConsultationTime && (
              <p className="mt-1 text-xs font-semibold text-[#00555A]">Predicted Consultation Time: {predictedConsultationTime}</p>
            )}
            <p className="mt-1 text-xs font-semibold text-gray-500">Status: {queuePosition?.session_status || "active"}</p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-600">Your position:</span>
            <span className="font-semibold text-[#0F172A]">{yourPosition} of {totalInQueue}</span>
          </div>
        </div>

        <div className="mb-6">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-[#00555A] transition-all duration-300"
              style={{ width: `${totalInQueue > 0 ? (yourPosition / totalInQueue) * 100 : 100}%` }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-gray-500">{yourPosition} of {totalInQueue} patients</p>
        </div>

        <button
          onClick={() => navigate("/patient")}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all duration-200 hover:bg-gray-50"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

const InfoRow = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-start gap-2">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
    <div className="min-w-0 flex-1">
      <p className="text-xs text-gray-600">{label}</p>
      <p className="font-medium text-[#0F172A]">{value}</p>
    </div>
  </div>
);

const MetricRow = ({ icon: Icon, label, value, highlight = false }: { icon: any; label: string; value: string; highlight?: boolean }) => (
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-gray-600">
      <Icon className="h-4 w-4" />
      {label}
    </span>
    <span className={highlight ? "font-medium text-[#00555A]" : "font-semibold text-[#0F172A]"}>{value}</span>
  </div>
);

export default TrackQueue;
