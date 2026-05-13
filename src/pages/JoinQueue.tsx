import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";
import { formatTimeRange as formatSlotTimeRange } from "@/lib/timeFormat";
import { ArrowRight, MapPinned, Search, Ticket } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────────────────
interface TimeSlot {
  slot_name: string;
  time_range: number[];
  slot_id?: number;
  is_open: boolean;
  is_expired: boolean;
  display_status: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────────────────
interface Doctor {
  id: string;
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

type Step = "options" | "form" | "loading" | "success" | "error";

// ─── Component ────────────────────────────────────────────────────────────────────────────────
const JoinQueue = () => {
  // QR codes should link to /join?clinic_id=XYZ
  const [searchParams] = useSearchParams();
  const qrClinicId = searchParams.get("clinic_id") || "";
  const navigate = useNavigate();

  const { addWalkinToQueue } = useQueue();

  const [step, setStep] = useState<Step>("options");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<number | "">("");
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [clinicInfo, setClinicInfo] = useState<ClinicInfo | null>(null);
  const [quickBookChecking, setQuickBookChecking] = useState(false);

  const formatTimeRange = (start: number, end: number) => {
    return formatSlotTimeRange([start, end]);
  };

  // Check if a slot has expired based on current time (15 min before slot ends)
  const isSlotExpired = (timeRange: number[]) => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endTimeMinutes = timeRange[1] * 60;
    const cutoffMinutes = endTimeMinutes - 15; // 15 min before slot ends

    // Handle overnight slots (end > 24 means next day)
    if (timeRange[1] > 24) {
      const normalizedEndMinutes = (timeRange[1] - 24) * 60;
      const normalizedCutoffMinutes = normalizedEndMinutes - 15;
      return currentMinutes >= normalizedCutoffMinutes;
    }

    // Normal slot: check if current time is past cutoff (15 min before end)
    return currentMinutes >= cutoffMinutes;
  };
  const [clinicLoading, setClinicLoading] = useState(false);
  const [tokenResult, setTokenResult] = useState<{
    token_label: string;
    position: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // ─── Fetch clinic info when clinic_id is known ────────────────────────────────────────────────
  useEffect(() => {
    if (!qrClinicId) return;
    setClinicLoading(true);
    fetch(`/api/auth/clinic/data?clinic_id=${qrClinicId}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        setClinicInfo({
          id: data.clinic_id || qrClinicId,
          name: data.clinic_name || "Clinic",
          address: data.address,
          doctors: data.doctors || [],
          isActive: Boolean(data.is_active && data.available !== false),
        });
      })
      .catch(() => {
        setClinicInfo({ id: qrClinicId, name: "Clinic", doctors: [], isActive: false });
      })
      .finally(() => setClinicLoading(false));
  }, [qrClinicId]);

  // ─── Fetch time slots ───────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!qrClinicId) return;
    setSlotsLoading(true);
    fetch(`/api/auth/clinic/time-slots?clinic_id=${qrClinicId}`)
      .then((r) => r.json())
      .then((data) => {
        const slotArray = data.slot || [];
        const slots = (data.slots || []).map((s: any, idx: number) => {
          const isOpen = slotArray[idx] === "open";
          const isExpired = isSlotExpired(s.time_range);
          return {
            ...s,
            slot_id: idx + 1,
            is_open: isOpen,
            is_expired: isExpired,
            display_status: isExpired ? "Expired" : (isOpen ? "Available" : "Not Available")
          };
        }).sort((a: TimeSlot, b: TimeSlot) => {
          const aStart = a.time_range?.[0] ?? Number.POSITIVE_INFINITY;
          const bStart = b.time_range?.[0] ?? Number.POSITIVE_INFINITY;
          return aStart - bStart;
        });
        // Show ALL slots - open and closed (closed slots will be disabled)
        setTimeSlots(slots);
      })
      .catch(() => setTimeSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [qrClinicId]);

  // ─── Handle sign up option ───────────────────────────────────────────────────────────────────
  const handleSignUp = () => {
    navigate("/patient/signup", { state: { fromJoinQueue: true, clinic_id: qrClinicId } });
  };

  // ─── Handle quick book option ───────────────────────────────────────────────────────────────
  const handleQuickBook = async () => {
    setErrorMsg("");
    setQuickBookChecking(true);

    try {
      const response = await fetch(`/api/auth/clinic/data?clinic_id=${qrClinicId}`);
      if (!response.ok) {
        throw new Error("Clinic not found");
      }

      const data = await response.json();
      const isActive = Boolean(data.is_active && data.available !== false);
      setClinicInfo({
        id: data.clinic_id || qrClinicId,
        name: data.clinic_name || "Clinic",
        address: data.address,
        doctors: data.doctors || [],
        isActive,
      });

      if (!isActive) {
        setErrorMsg("Clinic isn't opened yet.");
        return;
      }

      setStep("form");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to check clinic status.");
    } finally {
      setQuickBookChecking(false);
    }
  };

  const handleSlotSelect = (slot: TimeSlot, slotNum: number) => {
    if (!slot.is_open) {
      setErrorMsg("Clinic isn't opened yet.");
      return;
    }

    if (slot.is_expired) {
      setErrorMsg("This slot has already closed.");
      return;
    }

    setErrorMsg("");
    setSelectedSlotId(slotNum);
  };

  // ─── Validation ────────────────────────────────────────────────────────────────────────────────
  const phoneRegex = /^[6-9]\d{9}$/;
  const isValid =
    name.trim().length >= 2 &&
    phoneRegex.test(phone.trim()) &&
    selectedSlotId !== "" &&
    clinicInfo?.isActive !== false &&
    timeSlots.length > 0; // Ensure slots are loaded

  // ─── Submit ────────────────────────────────────────────────────────────────────────────────────
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
      });
      setStep("success");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setErrorMsg(errorMessage);
      setStep("error");
    }
  };

  // ─── Go back to home ────────────────────────────────────────────────────────────────────────────
  const handleGoHome = () => {
    window.location.href = "/";
  };

  // ─── Render ────────────────────────────────────────────────────────────────────────────────────

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

  // Options screen - choose between Sign up or Quick book
  if (step === "options") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 text-center shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary font-display text-2xl font-bold text-primary-foreground">
            K
          </div>
          <h2 className="mb-2 text-xl font-semibold text-[#0F172A]">Join Queue</h2>
          {clinicInfo && (
            <p className="mb-6 text-sm font-medium text-primary">{clinicInfo.name}</p>
          )}
          
          {errorMsg && (
            <div className="mb-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <p className="mb-6 text-sm text-muted-foreground">
            Would you like to sign up for the full experience or continue with a quick booking?
          </p>

          {/* Sign up option */}
          <button
            onClick={handleSignUp}
            className="mb-3 w-full rounded-xl bg-primary px-4 py-4 text-sm font-medium text-primary-foreground shadow-[0_14px_28px_-18px_rgba(31,92,84,0.9)] transition-all duration-200 hover:bg-primary/90"
          >
            <span className="block font-semibold">Sign Up for Full Experience</span>
            <span className="block text-xs text-white/70 mt-1">Live queue tracking, appointment history & more</span>
          </button>

          {/* Quick book option */}
          <button
            onClick={handleQuickBook}
            disabled={quickBookChecking}
            className="w-full rounded-xl border border-primary/25 bg-primary/5 px-4 py-4 text-sm font-medium text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/10"
          >
            <span className="block font-semibold text-primary">
              {quickBookChecking ? "Checking clinic..." : "Quick Book"}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">Just book a slot - no account needed</span>
          </button>
        </div>
      </div>
    );
  }

  // Success screen
  if (step === "success" && tokenResult) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm rounded-3xl border border-primary/10 bg-white p-8 text-center shadow-[0_22px_70px_-38px_rgba(19,55,50,0.55)]">
          {/* Tick icon */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h2 className="text-lg font-semibold text-[#0F172A] mb-1">You're in the queue!</h2>
          {clinicInfo && (
            <p className="mb-6 text-sm font-medium text-primary">{clinicInfo.name}</p>
          )}

          {/* Token badge */}
          <div className="rounded-2xl bg-[#FFC107] px-6 py-6 mb-6">
            <p className="text-xs font-medium uppercase tracking-widest text-[#0F172A] mb-1">
              Your Token
            </p>
            <p className="text-5xl font-extrabold tracking-widest text-[#0F172A]">
              {tokenResult.token_label}
            </p>
          </div>

          <div className="mb-6 rounded-xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <span className="text-muted-foreground">Patients ahead of you: </span>
            <span className="font-semibold">{Math.max(0, tokenResult.position - 1)}</span>
          </div>

          <p className="mb-4 text-xs text-muted-foreground">
            Please wait for your token to be called.
          </p>

          <div className="mb-4 rounded-2xl border border-primary/15 bg-primary/5 p-4 text-left">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
              <MapPinned className="h-4 w-4" />
              Check it later from the header
            </div>
            <div className="rounded-xl border border-primary/10 bg-white p-3">
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
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90"
            >
              Open Your Token
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleGoHome}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90"
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

          {/* Slot selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-primary">Select time slot</label>
            {slotsLoading ? (
              <div className="space-y-2">
                <div className="h-14 animate-pulse rounded-xl bg-primary/10" />
                <div className="h-14 animate-pulse rounded-xl bg-primary/10" />
              </div>
            ) : timeSlots.length > 0 ? (
              <div className="space-y-2">
                {timeSlots.map((slot, idx) => {
                  const slotNum = slot.slot_id ?? idx + 1;
                  const isUnavailable = !slot.is_open || slot.is_expired;
                  const isSelected = selectedSlotId === slotNum;

                  return (
                    <button
                      key={slotNum}
                      type="button"
                      onClick={() => handleSlotSelect(slot, slotNum)}
                      className={[
                        "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all duration-200",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-[0_14px_30px_-22px_rgba(31,92,84,0.9)]"
                          : "border-primary/15 bg-white text-foreground hover:border-primary/35 hover:bg-primary/5",
                        isUnavailable
                          ? "border-border bg-secondary/60 text-muted-foreground opacity-70 hover:border-border hover:bg-secondary/60"
                          : ""
                      ].join(" ")}
                    >
                      <span>
                        <span className="block text-sm font-semibold">
                          {slot.slot_name || `Slot ${slotNum}`}
                        </span>
                        <span className={isSelected ? "mt-0.5 block text-xs text-white/75" : "mt-0.5 block text-xs text-muted-foreground"}>
                          {formatTimeRange(slot.time_range[0], slot.time_range[1])}
                        </span>
                      </span>
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          isSelected
                            ? "bg-white/15 text-white"
                            : isUnavailable
                              ? "bg-[#FFC107]/20 text-[#7A5800]"
                              : "bg-primary/10 text-primary"
                        ].join(" ")}
                      >
                        {slot.display_status}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No slots configured for this clinic</p>
            )}
          </div>

          {/* Doctor selector — shown only if clinic has multiple doctors */}
          {clinicInfo && clinicInfo.doctors.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-primary">Select doctor</label>
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                className="w-full rounded-lg border border-primary/20 bg-white px-4 py-3 text-sm text-foreground transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Any available doctor</option>
                {clinicInfo.doctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}{doc.specialization ? ` — ${doc.specialization}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
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
              Getting your token...
            </span>
          ) : (
            "Get Token & Join Queue"
          )}
        </button>

        {/* Back to options */}
        <button
          onClick={() => setStep("options")}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-primary"
        >
          ← Back to options
        </button>
      </div>
    </div>
  );
};

export default JoinQueue;
