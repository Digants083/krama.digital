import { useCallback, useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQueueRealtime } from "@/hooks/useQueueRealtime";
import { formatDurationMinutes, formatIsoClock } from "@/lib/timeFormat";
import { Check, QrCode, Ticket } from "lucide-react";

// Types
interface ClinicInfo {
  id: string;
  name: string;
  address?: string;
}

type Step = "form" | "loading" | "success" | "error";

// Component
const WalkinQueue = () => {
  // QR codes should link to /walkin?clinic_id=XYZ
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qrClinicId = searchParams.get("clinic_id") || "";

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [clinicInfo, setClinicInfo] = useState<ClinicInfo | null>(null);
  const [clinicLoading, setClinicLoading] = useState(true);
  const [tokenResult, setTokenResult] = useState<{
    token_label: string;
    position: number;
    patient_name: string;
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

  // Fetch clinic info when clinic_id is known
  useEffect(() => {
    if (!qrClinicId) {
      setClinicLoading(false);
      return;
    }

    fetch(`/api/auth/clinics/${qrClinicId}`)
      .then((r) => r.json())
      .then((data) => {
        setClinicInfo({
          id: data.id || qrClinicId,
          name: data.name || "Clinic",
          address: data.address,
        });
      })
      .catch(() => {
        setClinicInfo({ id: qrClinicId, name: "Clinic" });
      })
      .finally(() => setClinicLoading(false));
  }, [qrClinicId]);

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

  // Validation
  const phoneRegex = /^[6-9]\d{9}$/;
  const isValid =
    name.trim().length >= 2 &&
    phoneRegex.test(phone.trim());

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
          doctor_id: "1", // Default doctor for walk-ins
          patient_name: name.trim(),
          phone: phone.trim(),
          source: "walkin",
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
        patient_name: data.patient_name,
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
    navigate("/");
  };

  // Render

  // Invalid QR code
  if (!qrClinicId) {
    return (
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
        <div className="motion-rise w-full max-w-sm rounded-[30px] border border-white/70 bg-white/85 p-8 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
            <QrCode className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">
            Invalid QR code. Please scan the clinic's QR code again.
          </p>
        </div>
      </div>
    );
  }

  // Loading clinic info
  if (clinicLoading) {
    return (
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
        <div className="motion-rise w-full max-w-sm rounded-[30px] border border-white/70 bg-white/85 p-8 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur">
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
            <Check className="h-7 w-7" />
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
              <p className="mt-1 text-xs font-semibold text-[#00555A]">Predicted Consultation Time: {formatIsoClock(tokenResult.predicted_eta)}</p>
            )}
            {tokenResult.estimated_wait_minutes != null && (
              <p className="mt-1 text-xs text-muted-foreground">Estimated wait {formatDurationMinutes(tokenResult.estimated_wait_minutes)}</p>
            )}
          </div>

          {hasActiveDelay && (
            <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 px-4 py-4 text-left">
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

          <button
            onClick={handleGoHome}
            className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-black text-white transition-all duration-200 hover:bg-primary/90"
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
      <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
        <div className="motion-rise w-full max-w-sm rounded-[30px] border border-white/70 bg-white/85 p-8 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#0F172A] mb-2">Couldn't join queue</h2>
          <p className="text-sm text-gray-500 mb-6">{errorMsg}</p>
          <button
            onClick={() => { setStep("form"); setErrorMsg(""); }}
            className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-black text-white transition-all duration-200 hover:bg-primary/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Form screen
  return (
    <div className="krama-ambient flex min-h-screen items-center justify-center px-4 py-8">
      <div className="motion-rise w-full max-w-sm rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur sm:p-6">

        {/* Header */}
        <div className="mb-6 text-center">
          <div className="motion-breathe mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#143b34] text-white shadow-[0_18px_48px_-32px_rgba(31,92,84,0.9)]">
            <QrCode className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-black text-[#17312d]">
            {clinicInfo?.name || "Join Queue"}
          </h1>
          {clinicInfo?.address && (
            <p className="mt-0.5 text-xs text-muted-foreground">{clinicInfo.address}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">Enter your details to get a token</p>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-bold text-primary">Full name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ravi Kumar"
              className="w-full rounded-2xl border border-primary/15 bg-[#fbfaf7] px-4 py-3 text-sm font-semibold text-foreground transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="mb-1 block text-xs font-bold text-primary">Mobile number</label>
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

        <button
          onClick={handleJoin}
          disabled={!isValid || step === "loading"}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-black text-white shadow-[0_14px_28px_-18px_rgba(31,92,84,0.9)] transition-all duration-200 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
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
            <>
              <Ticket className="h-4 w-4" />
              Get Token & Join Queue
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default WalkinQueue;
