import { useCallback, useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { formatDelayedStartTime, formatDelayLabel, formatDurationMinutes, formatIsoClock, formatTimeRange as formatSlotTimeRange } from "@/lib/timeFormat";
import { ArrowRight, CheckCircle2, MapPinned, Search, Stethoscope, Ticket } from "lucide-react";
import { getPatientSlotStatus, isSlotManuallyOpen } from "@/lib/slotStatus";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";

// Types
interface TimeSlot {
  slot_name: string;
  session_name?: string;
  time_range: number[];
  time_label?: string;
  slot_id?: number;
  session_id?: number;
  is_open: boolean;
  is_expired: boolean;
  display_status: string;
  delay_minutes?: number;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
}

type RawTimeSlot = Omit<TimeSlot, "is_open" | "is_expired" | "display_status"> & {
  is_open?: boolean | string | number | null;
  is_expired?: boolean;
  display_status?: string;
};

type SessionSlot = {
  session_id: number;
  slot_id?: number;
  session_name?: string;
  slot_name?: string;
  time_range: number[];
  time_label?: string;
  status?: string;
  is_open?: boolean;
  delay_minutes?: number;
  delay_ends_at?: string | null;
  delay_original_start_time?: string | null;
  delay_updated_start_time?: string | null;
};

// Types
interface Doctor {
  id: string;
  doctor_id?: string;
  name: string;
  specialization?: string;
}

interface ClinicInfo {
  id: string;
  name: string;
  address?: string;
  doctors: Doctor[];
  isActive?: boolean;
}

type Step = "form" | "loading" | "success" | "error";

// Component
const JoinQueue = () => {
  // QR codes should link to /join?clinic_id=XYZ
  const [searchParams] = useSearchParams();
  const qrClinicId = searchParams.get("clinic_id") || "";
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<number | "">("");
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [clinicInfo, setClinicInfo] = useState<ClinicInfo | null>(null);

  const formatTimeRange = (start: number, end: number) => {
    return formatSlotTimeRange([start, end]);
  };

  const [clinicLoading, setClinicLoading] = useState(Boolean(qrClinicId));
  const [tokenResult, setTokenResult] = useState<{
    token_label: string;
    position: number;
    predicted_eta?: string | null;
    consultation_window?: string | null;
    estimated_window_text?: string | null;
    estimated_wait_minutes?: number | null;
    active_delay_minutes?: number | null;
    doctor_delay?: string | null;
    delay_minutes?: number | null;
    delay_ends_at?: string | null;
    delay_original_start_time?: string | null;
    delay_updated_start_time?: string | null;
    session_status?: string | null;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const getDoctorValue = (doctor: Doctor) => String(doctor.doctor_id || doctor.id || "");
  const selectedDoctor = clinicInfo?.doctors.find((doctor) => getDoctorValue(doctor) === selectedDoctorId);
  const requiresDoctorSelection = Boolean(clinicInfo && clinicInfo.doctors.length > 1);
  const canShowSlots = !requiresDoctorSelection || Boolean(selectedDoctorId);

  const refreshTokenResult = useCallback(async () => {
    if (!tokenResult || !phone) return;
    try {
      const response = await fetch(`/api/auth/queue/lookup-by-phone?phone=${encodeURIComponent(phone)}`);
      if (!response.ok) return;
      const data = await response.json();
      const updated = (data.appointments || []).find((apt: any) => apt.token_label === tokenResult.token_label);
      if (!updated) return;
      setTokenResult((prev) => prev ? {
        ...prev,
        position: Number(String(updated.position || "").split("/")[0]) || prev.position,
        predicted_eta: updated.predicted_eta,
        consultation_window: updated.consultation_window,
        estimated_window_text: updated.estimated_window_text,
        estimated_wait_minutes: updated.estimated_wait_minutes,
        active_delay_minutes: updated.active_delay_minutes,
        doctor_delay: updated.doctor_delay,
        delay_minutes: updated.delay_minutes,
        delay_ends_at: updated.delay_ends_at,
        delay_original_start_time: updated.delay_original_start_time,
        delay_updated_start_time: updated.delay_updated_start_time,
        session_status: updated.session_status,
      } : prev);
    } catch (error) {
      console.error("Failed to refresh token timing:", error);
    }
  }, [phone, tokenResult]);

  useQueueRealtime(step === "success" ? clinicInfo?.id : null, () => void refreshTokenResult());

  // Fetch clinic info when clinic_id is known
  useEffect(() => {
    if (!qrClinicId) return;
    setClinicLoading(true);
    fetch(`/api/auth/clinic/data?clinic_id=${qrClinicId}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        const doctors = data.doctors || [];
        setClinicInfo({
          id: data.clinic_id || qrClinicId,
          name: data.clinic_name || "Clinic",
          address: data.address,
          doctors,
          isActive: Boolean(data.is_active && data.available !== false),
        });
        setSelectedDoctorId((current) => current || (doctors.length === 1 ? getDoctorValue(doctors[0]) : ""));
      })
      .catch(() => {
        setClinicInfo({ id: qrClinicId, name: "Clinic", doctors: [], isActive: false });
      })
      .finally(() => setClinicLoading(false));
  }, [qrClinicId]);

  // Fetch time slots from the same session status source used by clinic dashboards
  useEffect(() => {
    if (!qrClinicId || !clinicInfo) return;
    if (requiresDoctorSelection && !selectedDoctorId) {
      setTimeSlots([]);
      setSelectedSlotId("");
      return;
    }

    const toDisplayName = (slot: Pick<TimeSlot, "session_name" | "slot_name" | "session_id" | "slot_id">) => {
      const rawName = slot.session_name || slot.slot_name || `Session ${slot.session_id || slot.slot_id || ""}`;
      return rawName.replace("Time ", "Session ");
    };

    const mapSessionSlot = (session: SessionSlot): TimeSlot => {
      const slotStatus = getPatientSlotStatus(session.time_range, Boolean(session.is_open), new Date(), session.status);
      return {
        ...session,
        slot_name: toDisplayName(session),
        slot_id: session.session_id || session.slot_id,
        session_id: session.session_id,
        is_open: slotStatus.is_open,
        is_expired: slotStatus.is_expired,
        display_status: slotStatus.display_status,
        delay_minutes: Number(session.delay_minutes || 0),
      };
    };

    const mapLegacySlot = (slot: RawTimeSlot, idx: number, slotArray: string[], slotDelays: number[]): TimeSlot => {
      const isOpen = isSlotManuallyOpen(slot, slotArray, idx);
      const slotStatus = getPatientSlotStatus(slot.time_range, isOpen);
      const slotId = idx + 1;
      const delayMinutes = Number(slot.delay_minutes || slotDelays[idx] || 0);
      return {
        ...slot,
        slot_name: toDisplayName({ ...slot, slot_id: slotId }),
        slot_id: slotId,
        session_id: slotId,
        is_open: slotStatus.is_open,
        is_expired: slotStatus.is_expired,
        display_status: delayMinutes > 0 && slotStatus.is_open && !slotStatus.is_expired ? "Delayed" : slotStatus.display_status,
        delay_minutes: delayMinutes,
      };
    };

    const sortSlots = (a: TimeSlot, b: TimeSlot) => {
      const aStart = a.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      const bStart = b.time_range?.[0] ?? Number.POSITIVE_INFINITY;
      return aStart - bStart;
    };

    const fetchSlots = async () => {
      setSlotsLoading(true);
      try {
        const doctorQuery = selectedDoctorId ? `?doctor_id=${encodeURIComponent(selectedDoctorId)}` : "";
        const sessionsResponse = await fetch(`/api/sessions/today/${encodeURIComponent(qrClinicId)}${doctorQuery}`);
        if (sessionsResponse.ok) {
          const data = await sessionsResponse.json();
          const sessions = (data.sessions || []).map(mapSessionSlot).sort(sortSlots);
          if (sessions.length > 0) {
            setTimeSlots(sessions);
            return;
          }
        }

        const params = new URLSearchParams({ clinic_id: qrClinicId });
        if (selectedDoctorId) params.set("doctor_id", selectedDoctorId);
        const legacyResponse = await fetch(`/api/auth/clinic/time-slots?${params.toString()}`);
        const legacyData = await legacyResponse.json();
        const slotArray = legacyData.slot || [];
        const slotDelays = legacyData.slot_delays || [];
        const slots = (legacyData.slots || []).map((slot: RawTimeSlot, idx: number) => mapLegacySlot(slot, idx, slotArray, slotDelays)).sort(sortSlots);
        setTimeSlots(slots);
      } catch (error) {
        console.error("Error fetching time slots:", error);
        setTimeSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    };

    void fetchSlots();
  }, [clinicInfo, qrClinicId, requiresDoctorSelection, selectedDoctorId]);
  const handleSlotSelect = (slot: TimeSlot, slotNum: number) => {
    if (!slot.is_open) {
      setErrorMsg("This slot is not available.");
      return;
    }

    if (slot.is_expired) {
      setErrorMsg("This slot has already closed.");
      return;
    }

    setErrorMsg("");
    setSelectedSlotId(slotNum);
  };

  const handleDoctorSelect = (doctorId: string) => {
    setSelectedDoctorId(doctorId);
    setSelectedSlotId("");
    setErrorMsg("");
  };

  // Validation
  const phoneRegex = /^[6-9]\d{9}$/;
  const selectedSlot = timeSlots.find((slot) => (slot.slot_id || slot.session_id) === selectedSlotId);
  const isValid =
    name.trim().length >= 2 &&
    phoneRegex.test(phone.trim()) &&
    canShowSlots &&
    selectedSlotId !== "" &&
    clinicInfo?.isActive !== false &&
    Boolean(selectedSlot?.is_open) &&
    !selectedSlot?.is_expired &&
    timeSlots.length > 0; // Ensure slots are loaded

  // Submit
  const handleJoin = async () => {
    if (!isValid || !clinicInfo) return;
    setStep("loading");

    try {
      const res = await fetch("/api/auth/queue/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicInfo.id,
          doctor_id: selectedDoctorId || "1",
          patient_name: name.trim(),
          phone: phone.trim(),
          source: "walkin",
          slot_id: selectedSlotId || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to join queue");
      }

      const data = await res.json();
      setTokenResult({
        token_label: data.token_label,
        position: data.position,
        predicted_eta: data.predicted_eta,
        consultation_window: data.consultation_window,
        estimated_window_text: data.estimated_window_text,
        estimated_wait_minutes: data.estimated_wait_minutes,
        active_delay_minutes: data.active_delay_minutes,
        doctor_delay: data.doctor_delay,
        delay_minutes: data.delay_minutes,
        delay_ends_at: data.delay_ends_at,
        delay_original_start_time: data.delay_original_start_time,
        delay_updated_start_time: data.delay_updated_start_time,
        session_status: data.session_status,
      });
      setStep("success");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMsg(errorMessage);
      setStep("error");
    }
  };

  // Go back to home
  const handleGoHome = () => {
    window.location.href = "/";
  };

  // Render

  // Invalid QR code
  if (!qrClinicId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 text-center shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          <p className="text-sm text-muted-foreground">
            Invalid QR code. Please scan the clinic's QR code again.
          </p>
        </div>
      </div>
    );
  }

  // Loading clinic info
  if (clinicLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 text-center shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          <div className="mx-auto mb-2 h-6 w-32 animate-pulse rounded bg-primary/10" />
          <div className="mx-auto h-4 w-24 animate-pulse rounded bg-primary/10" />
        </div>
      </div>
    );
  }

  // Success screen
  if (step === "success" && tokenResult) {
    const activeDelayMinutes = tokenResult.active_delay_minutes || tokenResult.delay_minutes || 0;
    const hasActiveDelay = Boolean(tokenResult.doctor_delay || activeDelayMinutes > 0);
    const delayAmountText = activeDelayMinutes > 0 ? `+${formatDurationMinutes(activeDelayMinutes)}` : tokenResult.doctor_delay;
    return (
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
        <div className="motion-rise w-full max-w-sm rounded-[32px] border border-white/70 bg-white/85 p-5 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur sm:p-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
            <CheckCircle2 className="h-7 w-7" />
          </div>

          <h2 className="mb-1 font-display text-2xl font-black text-[#17312d]">You're in the queue!</h2>
          {clinicInfo && (
            <p className="mb-5 text-sm font-bold text-primary">{clinicInfo.name}</p>
          )}

          <div className="motion-shimmer mb-4 rounded-[28px] bg-[#143b34] px-6 py-6 text-white shadow-[0_24px_70px_-42px_rgba(31,92,84,0.95)]">
            <p className="mb-1 text-xs font-black uppercase tracking-[0.22em] text-white/60">
              Your Token
            </p>
            <p className="font-display text-5xl font-black tracking-widest">
              {tokenResult.token_label}
            </p>
          </div>

          <div className="mb-4 rounded-2xl border border-[#eadfce] bg-[#fbfaf7] px-4 py-3 text-sm text-[#17312d]">
            <span className="text-muted-foreground">Patients ahead of you: </span>
            <span className="font-semibold">{Math.max(0, tokenResult.position - 1)}</span>
          </div>

          <div className="mb-4 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-4 text-left">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Estimated consultation window</p>
            <p className="mt-1 text-lg font-black text-[#17312d]">{tokenResult.consultation_window || tokenResult.estimated_window_text || "Calculating..."}</p>
            {tokenResult.predicted_eta && (
              <p className="mt-1 text-xs font-semibold text-primary">Predicted Consultation Time: {formatIsoClock(tokenResult.predicted_eta)}</p>
            )}
            {tokenResult.estimated_wait_minutes != null && (
              <p className="mt-1 text-xs text-muted-foreground">Estimated wait {formatDurationMinutes(tokenResult.estimated_wait_minutes)}</p>
            )}
          </div>

          {hasActiveDelay && (
            <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Delay update</p>
              <p className="mt-1 text-lg font-bold text-orange-900">Slot delayed by {delayAmountText}</p>
              {tokenResult.delay_original_start_time && tokenResult.delay_updated_start_time && (
                <p className="mt-1 text-sm text-orange-800">
                  Original {tokenResult.delay_original_start_time} - New {tokenResult.delay_updated_start_time}
                </p>
              )}
              <p className="mt-1 text-sm text-orange-800">
                New ETA: {formatIsoClock(tokenResult.predicted_eta) || tokenResult.consultation_window || tokenResult.estimated_window_text || "Calculating..."}
              </p>
            </div>
          )}

          <p className="mb-4 text-xs font-semibold text-muted-foreground">
            Please wait for your token to be called.
          </p>

          <div className="mb-4 rounded-[24px] border border-white/70 bg-[#fbfaf7] p-4 text-left shadow-[0_16px_44px_-36px_rgba(19,55,50,0.65)]">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
              <MapPinned className="h-4 w-4" />
              Check it later from the header
            </div>
            <div className="rounded-2xl border border-[#eadfce] bg-white p-3">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm font-bold text-primary">Krama</span>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Your Token
                </span>
              </div>
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs text-muted-foreground">
                <Ticket className="h-4 w-4 text-primary" />
                <span>Open Your Token</span>
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <Search className="h-4 w-4 text-primary" />
                <span>Enter {phone || "your phone number"}</span>
                <ArrowRight className="h-3.5 w-3.5 text-primary" />
                <Ticket className="h-4 w-4 text-primary" />
                <span>See token and queue position</span>
                <span />
              </div>
            </div>
            <button
              onClick={() => navigate("/your-token")}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground transition-all duration-200 hover:bg-primary/90"
            >
              Open Your Token
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleGoHome}
            className="w-full rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-black text-primary transition-all duration-200 hover:bg-primary/10"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Error screen
  if (step === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 text-center shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <svg className="h-7 w-7 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#0F172A] mb-2">Couldn't join queue</h2>
          <p className="mb-6 text-sm text-muted-foreground">{errorMsg}</p>
          <button
            onClick={() => { setStep("form"); setErrorMsg(""); }}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Form screen
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary font-display text-xl font-bold text-primary-foreground">
            K
          </div>
          <h1 className="text-lg font-semibold text-[#0F172A]">
            {clinicInfo?.name || "Join Queue"}
          </h1>
          {clinicInfo?.address && (
            <p className="mt-0.5 text-xs text-muted-foreground">{clinicInfo.address}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">Enter your details to get a token</p>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {errorMsg}
          </div>
        )}

        {clinicInfo?.isActive === false && !errorMsg && (
          <div className="mb-4 rounded-lg bg-[#FFC107]/15 px-4 py-2 text-sm text-[#7A5800]">
            Clinic isn't opened yet.
          </div>
        )}

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-primary">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ravi Kumar"
              className="w-full rounded-lg border border-primary/20 bg-white px-4 py-3 text-sm text-foreground transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="mb-1 block text-xs font-medium text-primary">Mobile number</label>
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

          {/* Doctor selector - shown only if clinic has multiple doctors */}
          {clinicInfo && clinicInfo.doctors.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-primary">Select doctor</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {clinicInfo.doctors.map((doc) => (
                  <button
                    key={getDoctorValue(doc)}
                    type="button"
                    onClick={() => handleDoctorSelect(getDoctorValue(doc))}
                    className={[
                      "group flex min-h-[92px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200",
                      selectedDoctorId === getDoctorValue(doc)
                        ? "border-primary bg-primary text-primary-foreground shadow-[0_14px_30px_-22px_rgba(31,92,84,0.9)]"
                        : "border-primary/15 bg-white text-foreground hover:border-primary/35 hover:bg-primary/5"
                    ].join(" ")}
                  >
                    <span className={selectedDoctorId === getDoctorValue(doc) ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white" : "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"}>
                      <Stethoscope className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{doc.name}</span>
                      <span className={selectedDoctorId === getDoctorValue(doc) ? "mt-0.5 block truncate text-xs text-white/75" : "mt-0.5 block truncate text-xs text-muted-foreground"}>
                        {doc.specialization || "General Practice"}
                      </span>
                    </span>
                    {selectedDoctorId === getDoctorValue(doc) && <CheckCircle2 className="h-5 w-5 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Slot selector */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-primary">Select time slot</label>
              {selectedDoctor && (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  {selectedDoctor.name}
                </span>
              )}
            </div>
            {!canShowSlots ? (
              <p className="rounded-xl border border-primary/10 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
                Choose a doctor to see that doctor's available, delayed, expired, and closed slots.
              </p>
            ) : slotsLoading ? (
              <div className="space-y-2">
                <div className="h-16 animate-pulse rounded-xl bg-primary/10" />
                <div className="h-16 animate-pulse rounded-xl bg-primary/10" />
              </div>
            ) : timeSlots.length > 0 ? (
              <div className="space-y-2">
                {timeSlots.map((slot, idx) => {
                  const slotNum = slot.slot_id ?? idx + 1;
                  const isUnavailable = !slot.is_open || slot.is_expired;
                  const isSelected = selectedSlotId === slotNum;
                  const delayLabel = formatDelayLabel(slot.delay_minutes);
                  const displayStatus = slot.display_status === "Available" || slot.display_status === "Ongoing"
                    ? "Open"
                    : slot.display_status;
                  const statusBadgeClass = slot.display_status === "Expired"
                    ? "bg-red-100 text-red-700"
                    : slot.display_status === "Delayed"
                      ? "bg-orange-100 text-orange-700"
                      : slot.display_status === "Closed" || slot.display_status === "Not Available"
                        ? "bg-slate-200 text-slate-600"
                        : "bg-primary/10 text-primary";

                  return (
                    <button
                      key={slotNum}
                      type="button"
                      onClick={() => handleSlotSelect(slot, slotNum)}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-[0_14px_30px_-22px_rgba(31,92,84,0.9)]"
                          : "border-primary/15 bg-white text-foreground hover:border-primary/35 hover:bg-primary/5",
                        isUnavailable
                          ? "border-border bg-secondary/60 text-muted-foreground opacity-70 hover:border-border hover:bg-secondary/60"
                          : ""
                      ].join(" ")}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">
                          {slot.slot_name || `Session ${slotNum}`}
                        </span>
                        <span className={isSelected ? "mt-0.5 block text-xs text-white/75" : "mt-0.5 block text-xs text-muted-foreground"}>
                          {slot.time_label || formatTimeRange(slot.time_range[0], slot.time_range[1])}
                        </span>
                        {delayLabel && !slot.is_expired && (
                          <span className={isSelected ? "mt-2 block rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white" : "mt-2 block rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700"}>
                            Delay: {delayLabel}
                            <br />
                            {slot.delay_original_start_time && slot.delay_updated_start_time ? (
                              <>
                                <span className="line-through decoration-red-500/70 decoration-2">{slot.delay_original_start_time}</span>
                                {" -> "}
                                {slot.delay_updated_start_time}
                              </>
                            ) : <>New time: {formatDelayedStartTime(slot.time_range, slot.delay_minutes)}</>}
                          </span>
                        )}
                      </span>
                      <span
                        className={[
                          "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          isSelected ? "bg-white/15 text-white" : statusBadgeClass
                        ].join(" ")}
                      >
                        {displayStatus}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-muted-foreground">
                No slots configured for {selectedDoctor?.name || "this clinic"}.
              </p>
            )}
          </div>
        </div>

        <button
          onClick={handleJoin}
          disabled={!isValid || step === "loading"}
          className="mt-8 w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-[0_14px_28px_-18px_rgba(31,92,84,0.9)] transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {step === "loading" ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Confirming booking...
            </span>
          ) : (
            "Confirm Booking"
          )}
        </button>
      </div>
    </div>
  );
};

export default JoinQueue;
