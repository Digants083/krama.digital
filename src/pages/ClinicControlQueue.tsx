import { useState, useEffect, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Users, SkipForward, ArrowRightCircle, RefreshCw, Clock, QrCode, Calendar, Play, Square, MoveRight, FileText, Stethoscope, CheckCircle2, Mail, Send } from "lucide-react";
import { formatDelayedStartTime, formatDelayLabel, formatIsoClock, formatTimeRange } from "@/lib/timeFormat";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";

interface TimeSlot {
  slot_name: string;
  time_range: number[];
  is_open: boolean;
  delay_minutes?: number;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
  slot_id?: number;
  doctor_id?: string;
}

interface DoctorOption {
  doctor_id: string;
  name: string;
  specialization?: string;
}

const SERVE_UNLOCK_LEAD_MINUTES = 5;

const SourceBadge = ({ source }: { source: string }) => {
  const map: Record<string, { label: string; className: string }> = {
    walkin:  { label: "Walk-in",  className: "bg-[#FFC107]/20 text-[#7A5800]" },
    online:  { label: "Online",   className: "bg-[#00555A]/10 text-[#00555A]" },
    desk:    { label: "Desk",     className: "bg-slate-100 text-slate-600" },
  };
  const style = map[source] ?? map.desk;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${style.className}`}>
      {source === "walkin" && <QrCode className="h-3 w-3" />}
      {style.label}
    </span>
  );
};

const ClinicControlQueue = () => {
  const {
    queue,
    nextPatient,
    completePatient,
    skipPatient,
    currentToken,
    completedCount,
    totalToday,
    currentServing,
    fetchQueueForClinic,
    activeSlotId,
    viewingSlotId,
  } = useQueue();

  const [clinicId, setClinicId] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isClinicActive, setIsClinicActive] = useState(false);
  const [manualStopLocked, setManualStopLocked] = useState(false);
  const [activating, setActivating] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [pushingToken, setPushingToken] = useState<string | null>(null);
  const [reportingToken, setReportingToken] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [sendQuickBookOpen, setSendQuickBookOpen] = useState(false);
  const [quickBookEmail, setQuickBookEmail] = useState("");
  const [sendingQuickBook, setSendingQuickBook] = useState(false);

  const handlePrimaryQueueAction = async () => {
    if (currentServing) {
      const completed = await completePatient();
      if (completed) {
        localStorage.setItem("krama_pending_bill_patient", JSON.stringify(completed));
        setMessage({ text: `${completed.patient_name} completed. Open Billing to create the bill.`, type: "success" });
      }
      return;
    }
    void nextPatient();
  };

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const clinicStr = localStorage.getItem("clinic_id");
    if (clinicStr) {
      setClinicId(clinicStr);
      fetchQueueForClinic(clinicStr, selectedSlotId, currentServing?.startTime, selectedDoctorId || undefined);
    }
  }, [fetchQueueForClinic, selectedSlotId, currentServing?.startTime, selectedDoctorId]);

  useEffect(() => {
    if (!clinicId) return;

    const interval = setInterval(() => {
      fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime, selectedDoctorId || undefined);
    }, 15000);

    return () => clearInterval(interval);
  }, [clinicId, fetchQueueForClinic, selectedSlotId, currentServing?.startTime, selectedDoctorId]);

  useEffect(() => {
    if (currentServing?.startTime) {
      const interval = setInterval(() => {
        const diff = Math.floor(
          (new Date().getTime() - new Date(currentServing.startTime!).getTime()) / 1000
        );
        setElapsedTime(diff);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setElapsedTime(0);
    }
  }, [currentServing]);

  const handleRefreshQueue = () => {
    if (clinicId) fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime, selectedDoctorId || undefined);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const walkinCount = queue.filter((p) => p.source === "walkin").length;

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slotStatus, setSlotStatus] = useState<string[]>([]); // "open" or "close" for each slot
  const [loadingSlots, setLoadingSlots] = useState(false);

  const isSlotAvailable = (slot: TimeSlot, index: number, statuses = slotStatus) =>
    slot.is_open && statuses[index] !== "close";

  const sortedTimeSlots = timeSlots
    .map((slot, originalIndex) => ({ slot, originalIndex }))
    .sort((a, b) => {
      const aStart = a.slot.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      const bStart = b.slot.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    });

  useEffect(() => {
    if (clinicId) {
      fetchDoctors();
      fetchTimeSlots();
    }
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId || !selectedDoctorId) return;
    setSelectedSlotId(null);
    fetchTimeSlots();
    fetchQueueForClinic(clinicId, null, currentServing?.startTime, selectedDoctorId);
  }, [selectedDoctorId]);

  useEffect(() => {
    if (viewingSlotId !== null && selectedSlotId === null) {
      setSelectedSlotId(viewingSlotId);
    }
  }, [viewingSlotId, selectedSlotId]);

  useEffect(() => {
    if (!clinicId) return;

    const interval = setInterval(() => {
      fetchTimeSlots();
    }, 60000);

    return () => clearInterval(interval);
  }, [clinicId, isClinicActive]);

  useQueueRealtime(clinicId, () => {
    fetchTimeSlots();
    if (clinicId) {
      fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime, selectedDoctorId || undefined);
    }
  });

  const fetchDoctors = async () => {
    try {
      const response = await fetch(`/api/auth/clinic/doctors?clinic_id=${encodeURIComponent(clinicId)}`);
      if (!response.ok) return;
      const data = await response.json();
      const nextDoctors = data.doctors || [];
      setDoctors(nextDoctors);
      setSelectedDoctorId((current) => current || nextDoctors[0]?.doctor_id || "");
    } catch (error) {
      console.error("Error fetching doctors:", error);
    }
  };

  const fetchTimeSlots = async () => {
    setLoadingSlots(true);
    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (selectedDoctorId) params.set("doctor_id", selectedDoctorId);
      const response = await fetch(`/api/auth/clinic/time-slots?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        const slotDelays = data.slot_delays || [];
        const slots = (data.slots || []).map((slot: TimeSlot, index: number) => ({
          ...slot,
          delay_minutes: Number(slot.delay_minutes || slotDelays[index] || 0),
        }));
        setTimeSlots(slots);
        setSlotStatus(data.slot || []); // Set the slot status array (open/close)

        // Auto-logout 15 minutes before the last open slot ends.
        if (isClinicActive && slots.length > 0) {
          const now = new Date();
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          let latestEndMinutes = 0;

          for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index];
            if (isSlotAvailable(slot, index, data.slot || [])) {
              const endMinutes = slot.time_range[1] * 60;
              if (endMinutes > latestEndMinutes) {
                latestEndMinutes = endMinutes;
              }
            }
          }

          const cutoffMinutes = latestEndMinutes - 15;
          if (latestEndMinutes > 0 && currentMinutes >= cutoffMinutes) {
            handleDeactivate(false);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching time slots:", error);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (!clinicId) return;

    const fetchActiveStatus = () => {
      fetch(`/api/auth/clinic/active-status?clinic_id=${clinicId}`)
        .then(res => res.json())
        .then(data => {
          setIsClinicActive(data.is_active || false);
          setManualStopLocked(data.manual_stop_locked || false);
        })
        .catch(console.error);
    };

    fetchActiveStatus();
    const interval = setInterval(fetchActiveStatus, 60000);
    return () => clearInterval(interval);
  }, [clinicId]);

  const handleActivate = async () => {
    setActivating(true);
    try {
      const response = await fetch("/api/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: true })
      });
      if (response.ok) {
        setIsClinicActive(true);
        setManualStopLocked(false);
        setMessage({ text: "Clinic is now live.", type: "success" });
        fetchTimeSlots();
      } else {
        const error = await response.json().catch(() => ({}));
        setMessage({ text: error.detail || "Could not start clinic.", type: "error" });
      }
    } catch (error) {
      console.error("Error activating clinic:", error);
      setMessage({ text: "Network error while starting clinic.", type: "error" });
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async (manualStop = true) => {
    setActivating(true);
    try {
      const response = await fetch("/api/auth/clinic/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, is_active: false, manual_stop: manualStop })
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        setIsClinicActive(false);
        setManualStopLocked(data.manual_stop_date ? manualStop : false);
        setMessage({
          text: manualStop ? "Clinic is offline for today." : "Clinic is now offline.",
          type: "success"
        });
      } else {
        const error = await response.json().catch(() => ({}));
        setMessage({ text: error.detail || "Could not stop clinic.", type: "error" });
      }
    } catch (error) {
      console.error("Error deactivating clinic:", error);
      setMessage({ text: "Network error while stopping clinic.", type: "error" });
    } finally {
      setActivating(false);
    }
  };

  const totalTodayReal = completedCount + queue.length + (currentServing ? 1 : 0);

  // Check if all slots have expired
  const allSlotsExpired = () => {
    if (timeSlots.length === 0) return true;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    for (let index = 0; index < timeSlots.length; index += 1) {
      const slot = timeSlots[index];
      if (isSlotAvailable(slot, index)) {
        const endMinutes = slot.time_range[1] * 60;
        if (currentMinutes < endMinutes) {
          return false;
        }
      }
    }
    return true;
  };

  const canActivateNow = () => {
    if (timeSlots.length === 0) return false;
    const earliestSlotStart = Math.min(
      ...timeSlots
        .map((slot) => slot.time_range?.[0])
        .filter((start): start is number => typeof start === "number")
    );
    if (!Number.isFinite(earliestSlotStart)) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const activationThresholdMinutes = earliestSlotStart * 60 - 45;

    let latestEndMinutes = 0;
    for (let index = 0; index < timeSlots.length; index += 1) {
      const slot = timeSlots[index];
      if (isSlotAvailable(slot, index)) {
        const endMinutes = slot.time_range[1] * 60;
        if (endMinutes > latestEndMinutes) {
          latestEndMinutes = endMinutes;
        }
      }
    }

    if (latestEndMinutes <= 0) return false;

    const cutoffMinutes = latestEndMinutes - 15;

    return currentMinutes >= activationThresholdMinutes &&
      currentMinutes < cutoffMinutes;
  };

  const getStartDisabledReason = () => {
    if (activating) return "Updating clinic status...";
    if (isClinicActive) return "Clinic is already live.";
    if (timeSlots.length === 0) return "No time slots configured.";

    const starts = timeSlots
      .map((slot) => slot.time_range?.[0])
      .filter((start): start is number => typeof start === "number");
    if (starts.length === 0) return "No valid slot start time configured.";

    const earliestSlotStart = Math.min(...starts);
    const latestAvailableEnd = Math.max(
      ...timeSlots
        .map((slot, index) => isSlotAvailable(slot, index) ? slot.time_range?.[1] : undefined)
        .filter((end): end is number => typeof end === "number")
    );
    if (!Number.isFinite(latestAvailableEnd)) return "No available slots for today.";

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const activationThresholdMinutes = earliestSlotStart * 60 - 45;
    const cutoffMinutes = latestAvailableEnd * 60 - 15;

    if (currentMinutes < activationThresholdMinutes) {
      return "Start opens 45 minutes before the earliest slot.";
    }
    if (currentMinutes >= cutoffMinutes) {
      return "Live window ended 15 minutes before the last available slot.";
    }
    return "";
  };

  const startDisabledReason = getStartDisabledReason();

  const getCurrentTimeDecimal = () => {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60.0;
  };

  const getTimelineTimeDecimal = () => {
    const current = getCurrentTimeDecimal();
    const activeOvernightSlot = timeSlots.some((slot, index) => {
      if (!isSlotAvailable(slot, index)) return false;
      const [, endHour] = slot.time_range;
      return endHour > 24 && current < endHour - 24;
    });
    return activeOvernightSlot ? current + 24 : current;
  };

  const isTimeInsideSlot = (slot: TimeSlot) => {
    const timelineNow = getTimelineTimeDecimal();
    const [startHour, endHour] = slot.time_range;
    const delayHours = Number(slot.delay_minutes || 0) / 60;
    const effectiveStartHour = startHour + delayHours;
    const unlockTime = effectiveStartHour - SERVE_UNLOCK_LEAD_MINUTES / 60;
    return timelineNow >= unlockTime && timelineNow < endHour;
  };

  const getSlotById = (slotId: number) =>
    timeSlots.find((slot) => (slot.slot_id || timeSlots.indexOf(slot) + 1) === slotId);

  // Check if the currently viewed slot can serve patients now.
  const canServeInCurrentSlot = () => {
    if (timeSlots.length === 0) return false;

    const slotId = selectedSlotId ?? viewingSlotId ?? activeSlotId;
    if (typeof slotId === "number") {
      const slot = getSlotById(slotId);
      const slotIndex = timeSlots.indexOf(slot as TimeSlot);
      if (!slot || !isSlotAvailable(slot, slotIndex)) return false;
      return isTimeInsideSlot(slot);
    }

    return timeSlots.some((slot, index) => isSlotAvailable(slot, index) && isTimeInsideSlot(slot));
  };

  const isSlotExpired = (slot: TimeSlot): boolean => {
    const [, endHour] = slot.time_range;
    return getTimelineTimeDecimal() >= endHour;
  };

  // Check if a slot is available based on manual status and the normalized timeline.
  const isSlotCurrentlyAvailable = (slot: TimeSlot, index: number): boolean => {
    if (!isSlotAvailable(slot, index)) return false;
    return getTimelineTimeDecimal() < slot.time_range[1];
  };

  const isServingAllowedForViewingSlot =
    (selectedSlotId ?? viewingSlotId) !== null &&
    activeSlotId !== null &&
    (selectedSlotId ?? viewingSlotId) === activeSlotId;

  const currentSlotLabelId = selectedSlotId ?? viewingSlotId;
  const selectedSlot = typeof currentSlotLabelId === "number" ? getSlotById(currentSlotLabelId) : undefined;
  const isSelectedSlotExpired = selectedSlot ? isSlotExpired(selectedSlot) : false;
  const selectedDoctor = doctors.find((doctor) => doctor.doctor_id === selectedDoctorId);

  const handleSlotSelect = (slotId: number) => {
    setSelectedSlotId(slotId);
    if (clinicId) {
      fetchQueueForClinic(clinicId, slotId, currentServing?.startTime, selectedDoctorId || undefined);
    }
  };

  const pushPatientToNextSlot = async (appointmentId: number, token: string, source: string) => {
    if (!window.confirm(`Push patient ${token} to the next available slot? They will be added to the end of the queue.`)) {
      return;
    }

    setPushingToken(token);
    try {
      const response = await fetch("/api/auth/clinic/push-patient-to-next-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_id: appointmentId,
          source: source
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({
          text: data.action === "auto_finished"
            ? `Patient was in last slot - marked as not served`
            : `Patient ${token} pushed to next slot as ${data.new_token || "new token"} at position ${data.position || data.new_position || "end"}`,
          type: "success"
        });
        // Refresh the queue
        if (clinicId) {
          fetchQueueForClinic(clinicId, selectedSlotId, currentServing?.startTime, selectedDoctorId || undefined);
        }
      } else {
        setMessage({ text: data.detail || "Failed to push patient", type: "error" });
      }
    } catch (error) {
      console.error("Error pushing patient:", error);
      setMessage({ text: "Network error while pushing patient", type: "error" });
    } finally {
      setPushingToken(null);
    }
  };

  const giveReportForCurrentPatient = async () => {
    if (!currentServing) return;

    const targetClinicId = currentServing.clinicId || clinicId;
    if (!targetClinicId) {
      setMessage({ text: "Clinic details missing for report request.", type: "error" });
      return;
    }

    const fallbackPatientId = currentServing.appointmentId
      ? `${currentServing.source || "online"}-${currentServing.appointmentId}`
      : currentServing.token;

    setReportingToken(currentServing.token);
    setMessage(null);

    try {
      const response = await fetch("/api/clinic/reports/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: targetClinicId,
          patient_id: currentServing.patient_id || fallbackPatientId,
          patient_name: currentServing.patientName,
          patient_email: currentServing.patient_email || "",
          patient_phone: currentServing.phone || "",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || "Failed to add patient to pending reports.");
      }

      setMessage({
        text: data.added ? "Patient added to pending reports." : "Report already pending for this patient.",
        type: "success",
      });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Failed to add patient to pending reports.",
        type: "error",
      });
    } finally {
      setReportingToken(null);
    }
  };

  // Check if a patient's slot has expired (for showing push button)
  const isPatientSlotExpired = (patientSlotId: number | null | undefined): boolean => {
    if (patientSlotId == null || timeSlots.length === 0) return false;

    const slotIndex = patientSlotId - 1;
    if (slotIndex < 0 || slotIndex >= timeSlots.length) return false;

    const slot = timeSlots[slotIndex];
    if (!slot || !Array.isArray(slot.time_range) || slot.time_range.length < 2) {
      return false;
    }
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeDecimal = currentHour + currentMinute / 60.0;

    const slotEnd = slot.time_range[1];
    return currentTimeDecimal >= slotEnd;
  };

  // Check if patient is in the last slot
  const isPatientInLastSlot = (patientSlotId: number | null): boolean => {
    if (patientSlotId === null || timeSlots.length === 0) return false;
    return patientSlotId >= timeSlots.length;
  };

  const sendQuickBookEmail = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const email = quickBookEmail.trim().toLowerCase();
    if (!clinicId) {
      setMessage({ text: "Clinic details missing. Please refresh and try again.", type: "error" });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ text: "Enter a valid email address.", type: "error" });
      return;
    }

    setSendingQuickBook(true);
    try {
      const response = await fetch("/api/auth/clinic/send-quick-book-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, email }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({ text: data.detail || "Failed to send quick book email.", type: "error" });
        return;
      }

      setMessage({ text: `Quick book link sent to ${email}.`, type: "success" });
      setQuickBookEmail("");
      setSendQuickBookOpen(false);
    } catch (error) {
      console.error("Error sending quick book email:", error);
      setMessage({ text: "Network error while sending quick book email.", type: "error" });
    } finally {
      setSendingQuickBook(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      {message && (
        <div
          className={`fixed right-4 top-20 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${
            message.type === "success" ? "bg-[#00555A] text-white" : "bg-red-600 text-white"
          }`}
        >
          {message.text}
        </div>
      )}
      <header className="sticky top-0 z-50 border-b border-[#e6ded3] bg-[#fbfaf7]/85 shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link to="/clinic" className="rounded-lg bg-[#f0ede6] p-2 text-slate-600 transition-colors hover:bg-[#e6ded3]">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Queue Control</h1>
              <p className="text-xs text-slate-500">Manage your clinic's patient queue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-lg border-[#00555A]/30 bg-[#fbfaf7] px-3 py-2 font-medium text-[#00555A] transition-all hover:bg-[#e9f6f1] sm:px-4"
              onClick={() => setSendQuickBookOpen(true)}
            >
              <Mail className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Send Quick Book</span>
            </Button>
            <Button
              variant="outline"
              className="rounded-lg border-[#d8d1c6] bg-[#fbfaf7] px-3 py-2 font-medium text-slate-600 transition-all hover:bg-[#f0ede6] sm:px-4"
              onClick={handleRefreshQueue}
            >
              <RefreshCw className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Clinic Status Card */}
        <div className={`sticky top-20 z-40 mb-6 flex flex-col gap-4 rounded-2xl border-2 p-5 shadow-lg backdrop-blur transition-all sm:flex-row sm:items-center sm:justify-between ${
            isClinicActive 
              ? "bg-gradient-to-r from-green-50 to-white border-green-200" 
              : "bg-gradient-to-r from-[#f0ede6] to-[#fbfaf7] border-[#e6ded3]"
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isClinicActive ? 'bg-green-100' : 'bg-slate-100'}`}>
                {isClinicActive ? (
                  <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                ) : (
                  <Clock className="h-6 w-6 text-slate-400" />
                )}
              </div>
              <div>
                <span className={`text-lg font-bold ${isClinicActive ? "text-green-700" : "text-slate-600"}`}>
                  {isClinicActive ? "Clinic is Live" : "Clinic is Offline"}
                </span>
                <p className="text-sm text-slate-500">{isClinicActive ? "Accepting patients" : "Not accepting patients"}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={handleActivate}
                disabled={Boolean(startDisabledReason)}
                title={startDisabledReason || "Start clinic"}
                className={`min-w-28 flex-1 rounded-lg px-6 py-2.5 font-medium shadow-md transition-all sm:flex-none ${
                  startDisabledReason
                    ? "bg-slate-200 text-slate-500 hover:bg-slate-200 hover:translate-y-0 shadow-none"
                    : "bg-green-500 hover:bg-green-600 text-white hover:shadow-lg"
                }`}
              >
                <Play className="h-4 w-4 mr-2" />
                Start
              </Button>
              <Button
                onClick={() => handleDeactivate(true)}
                disabled={activating || !isClinicActive}
                variant="outline"
                className="min-w-28 flex-1 rounded-lg border-red-300 px-6 py-2.5 font-medium text-red-500 transition-all hover:bg-red-50 sm:flex-none"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </div>
          </div>

          {doctors.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-[#d9eadf] bg-[#fbfaf7] shadow-sm">
              <div className="flex items-start justify-between gap-3 border-b border-[#e6ded3] bg-gradient-to-r from-[#eef8f3] to-[#fbfaf7] px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#dff4ea] text-[#00555A]">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-bold text-slate-900">Doctor Queue</h2>
                    <p className="mt-1 max-w-[210px] text-xs leading-5 text-slate-500 sm:max-w-none">Control one doctor's queue at a time.</p>
                  </div>
                </div>
                {selectedDoctor && (
                  <span className="inline-flex max-w-[38%] shrink-0 items-center gap-1.5 rounded-full bg-[#00555A]/10 px-2.5 py-1.5 text-xs font-bold text-[#00555A] sm:max-w-none sm:px-3">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="truncate">{selectedDoctor.name}</span>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 p-3 sm:gap-3 sm:p-4 lg:grid-cols-3">
                {doctors.map((doctor) => (
                  <button
                    key={doctor.doctor_id}
                    type="button"
                    onClick={() => setSelectedDoctorId(doctor.doctor_id)}
                    className={`group flex min-h-[132px] flex-col items-start justify-between rounded-xl border p-3 text-left transition-all sm:min-h-[112px] ${
                      selectedDoctorId === doctor.doctor_id
                        ? "border-[#00555A] bg-[#00555A] text-white shadow-[0_16px_34px_-24px_rgba(0,85,90,0.9)]"
                        : "border-[#d8d1c6] bg-white text-slate-800 hover:border-[#00555A]/60 hover:bg-[#f4fbf8]"
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-2">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${
                        selectedDoctorId === doctor.doctor_id ? "bg-white/18 text-white" : "bg-[#e1f5ee] text-[#00555A]"
                      }`}>
                        <Stethoscope className="h-5 w-5 sm:h-5 sm:w-5" />
                      </div>
                      {selectedDoctorId === doctor.doctor_id && <CheckCircle2 className="h-4 w-4 shrink-0 text-white/90" />}
                    </div>
                    <div className="min-w-0">
                      <span className="block max-w-full truncate text-sm font-bold">{doctor.name}</span>
                      <span className={`mt-1 block truncate text-xs font-medium ${
                        selectedDoctorId === doctor.doctor_id ? "text-white/80" : "text-slate-500"
                      }`}>
                        {doctor.specialization || "General Practice"}
                      </span>
                      <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ${
                        selectedDoctorId === doctor.doctor_id ? "bg-white/18 text-white" : "bg-[#00555A]/8 text-[#00555A] group-hover:bg-[#00555A]/12"
                      }`}>
                        {selectedDoctorId === doctor.doctor_id ? "Active queue" : "Open queue"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time Slots Card */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] shadow-lg">
            <div className="flex items-center gap-2 border-b border-[#e6ded3] bg-gradient-to-r from-[#f0ede6] to-[#fbfaf7] px-5 py-4">
              <Calendar className="h-5 w-5 text-[#00555A]" />
              <h2 className="font-semibold text-slate-800">Today's Time Slots</h2>
            </div>
            <div className="p-5">
              {loadingSlots ? (
                <div className="text-center py-6">
                  <div className="animate-spin h-6 w-6 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto"></div>
                  <p className="text-sm text-slate-500 mt-2">Loading slots...</p>
                </div>
              ) : timeSlots.length === 0 ? (
                <div className="text-center py-6">
                  <div className="bg-slate-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Clock className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-600 mb-2">No time slots configured.</p>
                  <Link to="/clinic/manage-time" className="text-[#00555A] text-sm font-medium hover:underline">
                    Set up time slots -&gt;
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sortedTimeSlots.map(({ slot, originalIndex }) => {
                    const slotId = slot.slot_id || originalIndex + 1;
                    const isCurrentlyAvailable = isSlotCurrentlyAvailable(slot, originalIndex);
                    const isSlotClosed = slotStatus[originalIndex] === "close";
                    const isExpired = isSlotExpired(slot);
                    const delayLabel = formatDelayLabel(slot.delay_minutes);
                    return (
                      <button
                        type="button"
                        key={slotId}
                        onClick={() => handleSlotSelect(slotId)}
                        className={`border-2 rounded-xl p-4 transition-all ${
                          currentSlotLabelId === slotId
                            ? "bg-gradient-to-r from-[#00555A]/10 to-white border-[#00555A] shadow-md"
                            : isCurrentlyAvailable
                              ? "bg-gradient-to-r from-green-50 to-white border-green-200"
                              : isExpired
                                ? "bg-gradient-to-r from-red-50 to-white border-red-200"
                              : "bg-slate-50 border-slate-200"
                        }`}
                        disabled={!slot.is_open && !isExpired}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-slate-800">{slot.slot_name.replace('Time ', 'Session ')}</h3>
                            <p className="text-sm text-slate-500 font-medium">
                              {delayLabel && slot.delay_original_start_time && slot.delay_updated_start_time ? (
                                <>
                                  <span className="line-through decoration-red-500/70 decoration-2 text-orange-700">{slot.delay_original_start_time}</span>
                                  <span className="px-1 text-orange-700">-&gt;</span>
                                  <span className="text-orange-700">{slot.delay_updated_start_time}</span>
                                </>
                              ) : formatTimeRange(slot.time_range)}
                            </p>
                            {delayLabel && !isExpired && (
                              <div className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 transition-all duration-300">
                                <p>Delay: {delayLabel}</p>
                                <p>New time: {slot.delay_updated_start_time || formatDelayedStartTime(slot.time_range, slot.delay_minutes)}</p>
                              </div>
                            )}
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isExpired ? 'bg-red-100 text-red-700' : isCurrentlyAvailable ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                            {isExpired ? 'Expired' : (isSlotClosed ? 'Not Available' : (isCurrentlyAvailable ? 'Available' : 'Unavailable'))}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-5 text-center shadow-lg">
              <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Users className="h-5 w-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">In Queue</p>
              <p className="text-3xl font-bold text-slate-800">{queue.length}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-5 text-center shadow-lg">
              <div className="bg-[#FFC107]/20 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <ArrowRightCircle className="h-5 w-5 text-[#FFC107]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Completed</p>
              <p className="text-3xl font-bold text-[#FFC107]">{completedCount}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-5 text-center shadow-lg">
              <div className="bg-[#00555A]/10 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Clock className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Now Serving</p>
              <p className="text-3xl font-bold text-[#00555A]">{currentServing ? 1 : 0}</p>
              {currentSlotLabelId && (
                <p className="text-xs text-slate-400 mt-1">Slot {currentSlotLabelId}</p>
              )}
            </div>
          </div>

          {/* Current Patient Card */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] shadow-lg">
            <div className="bg-gradient-to-r from-[#00555A] to-[#006e78] px-6 py-4">
              <p className="text-white font-semibold text-center">
                {currentServing ? "Now Serving" : queue.length > 0 ? "Next to Serve" : "No Patient"}
              </p>
            </div>
            <div className="p-6 text-center">
              {currentServing ? (
                <>
                  <div className="text-6xl font-extrabold text-slate-800 mb-4">{currentServing.token}</div>
                  <div className="rounded-xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-[#fbfaf7] p-4">
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
                      <p className="font-semibold text-slate-800 text-lg">
                        {currentServing.patientName}
                      </p>
                      <SourceBadge source={
                        queue.find((q) => q.token === currentServing.token)?.source || "online"
                      } />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
                      <Clock className="h-4 w-4" />
                      <span>Elapsed: {formatTime(elapsedTime)}</span>
                    </div>
                  </div>
                </>
              ) : queue.length > 0 ? (
                <>
                  <div className="text-6xl font-extrabold text-slate-800 mb-4">{queue[0].token}</div>
                  <div className="rounded-xl border-2 border-[#00555A]/20 bg-gradient-to-r from-[#00555A]/5 to-[#f0ede6] p-4">
                    <div className="flex items-center justify-center gap-2 flex-wrap mb-2">
                      <p className="font-semibold text-slate-800 text-lg">
                        {queue[0].name}
                      </p>
                      <SourceBadge source={queue[0].source} />
                    </div>
                    {queue[0].phone && (
                      <p className="text-xs text-slate-500">{queue[0].phone}</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-6xl font-extrabold text-slate-300 mb-4">--</div>
                  <p className="text-slate-500">No patients in queue</p>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-4 flex gap-3">
            <Button
              className={`h-10 flex-1 rounded-xl px-3 text-sm font-semibold shadow-sm transition-all duration-200 hover:opacity-90 hover:shadow-md ${
                currentServing
                  ? "bg-[#FFC107] text-[#0F172A]"
                  : "bg-[#00555A] text-white hover:bg-[#00494F]"
              }`}
              onClick={handlePrimaryQueueAction}
              disabled={
                (!currentServing && queue.length === 0) ||
                (!currentServing && queue.length > 0 && !canServeInCurrentSlot())
              }
            >
              <ArrowRightCircle className="mr-1.5 h-4 w-4" />
              {currentServing ? "Completed" : "Next Patient"}
            </Button>
            {currentServing && (
              <Button
                variant="outline"
                className="h-10 flex-1 rounded-xl border-[#00555A]/30 px-3 text-sm font-semibold text-[#00555A] transition-all duration-200 hover:bg-[#00555A]/10"
                onClick={giveReportForCurrentPatient}
                disabled={reportingToken === currentServing.token}
              >
                <FileText className="mr-1.5 h-4 w-4" />
                {reportingToken === currentServing.token ? "Adding..." : "Give Report"}
              </Button>
            )}
              <Button
                variant="outline"
                className="h-10 flex-1 rounded-xl border-slate-300 px-3 text-sm font-semibold text-slate-600 transition-all duration-200 hover:bg-slate-100"
                onClick={() => skipPatient()}
                disabled={queue.length < 2 || !canServeInCurrentSlot()}
              >
                <SkipForward className="mr-1.5 h-4 w-4" />
                Skip
              </Button>
          </div>

          {/* Waiting Queue */}
          <div className="overflow-hidden rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] shadow-md">
            <div className="flex items-center gap-2 border-b border-[#e6ded3] bg-gradient-to-r from-[#f0ede6] to-[#fbfaf7] px-4 py-3">
              <Users size={16} className="text-[#00555A]" />
              <h2 className="text-sm font-semibold text-slate-800 sm:text-base">Waiting Queue</h2>
              {typeof currentSlotLabelId === "number" && (
                <span className="ml-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Slot {currentSlotLabelId}
                  {isSelectedSlotExpired
                    ? " (Expired)"
                    : !isServingAllowedForViewingSlot
                      ? " (Upcoming)"
                      : ""}
                </span>
              )}
              {walkinCount > 0 && (
                <span className="ml-auto flex items-center gap-1 rounded-full bg-[#FFC107]/20 px-2 py-1 text-[11px] text-[#7A5800]">
                  <QrCode className="h-3 w-3" />
                  {walkinCount} walk-in{walkinCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="p-3 sm:p-4">
              {queue.length === 0 ? (
                <div className="py-6 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                    <Users className="h-5 w-5 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">No patients in queue</p>
                </div>
              ) : null}
              {queue.length > 0 && (
                <div className="space-y-2.5">
                  {queue.map((p, i) => (
                    <div
                      key={p.token}
                      className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border px-3 py-2.5 transition-all hover:shadow-sm ${
                        p.source === "walkin"
                          ? "border-[#FFC107]/30 bg-gradient-to-r from-[#FFC107]/10 to-white"
                          : "border-transparent bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                          p.source === "walkin" ? "bg-[#FFC107]/20 text-[#7A5800]" : "bg-[#00555A]/10 text-[#00555A]"
                        }`}>
                          {p.token}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight text-slate-800">
                            {p.name}
                          </p>
                          {p.source === "walkin" ? (
                            p.phone && (
                              <p className="truncate text-[11px] text-slate-500">{p.phone}</p>
                            )
                          ) : (
                            <>
                              {p.phone && (
                                <p className="truncate text-[11px] text-slate-500">{p.phone}</p>
                              )}
                              {p.patient_email && (
                                <p className="truncate text-[11px] text-slate-400">{p.patient_email}</p>
                              )}
                            </>
                          )}
                          {(p.consultation_window || p.estimated_window_text) && (
                            <p className="truncate text-[11px] font-semibold text-[#00555A]">
                              Window {p.consultation_window || p.estimated_window_text}
                            </p>
                          )}
                          {p.predicted_eta && (
                            <p className="truncate text-[11px] text-slate-500">
                              Predicted {formatIsoClock(p.predicted_eta)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <SourceBadge source={p.source} />
                        {isPatientSlotExpired(p.slot_id) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full border-amber-300 px-2 text-[11px] text-amber-700 hover:bg-amber-50"
                            onClick={() => pushPatientToNextSlot(p.appointment_id, p.token, p.source)}
                            disabled={pushingToken === p.token}
                          >
                            <MoveRight className="mr-1 h-3 w-3" />
                            {isPatientInLastSlot(p.slot_id) ? "Not Served" : "Push"}
                          </Button>
                        )}
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">#{i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
      </main>

      <Dialog open={sendQuickBookOpen} onOpenChange={setSendQuickBookOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Quick Book Link</DialogTitle>
            <DialogDescription>
              Email the clinic booking link to a patient.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void sendQuickBookEmail(event)}>
            <div className="space-y-2">
              <Label htmlFor="quick-book-email">Patient Email</Label>
              <Input
                id="quick-book-email"
                type="email"
                placeholder="patient@example.com"
                value={quickBookEmail}
                onChange={(event) => setQuickBookEmail(event.target.value)}
                disabled={sendingQuickBook}
                autoComplete="email"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSendQuickBookOpen(false)}
                disabled={sendingQuickBook}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#00555A] text-white hover:bg-[#00494F]"
                disabled={sendingQuickBook || !quickBookEmail.trim() || !clinicId}
              >
                <Send className="mr-2 h-4 w-4" />
                {sendingQuickBook ? "Sending..." : "Send Email"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClinicControlQueue;
