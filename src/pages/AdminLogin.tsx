import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Mail, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_CONFIRMATION_EMAIL_LABELS, ADMIN_EMAIL_LABELS } from "@/config/app";
import { apiUrl } from "@/lib/api";

type LocationState = {
  from?: {
    pathname?: string;
  };
};

const AdminLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [confirmationOtpCode, setConfirmationOtpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  // Where to redirect after login (default to dashboard)
  const from = (location.state as LocationState | null)?.from?.pathname || "/admin/dashboard";
  const primaryEmailLabel = ADMIN_EMAIL_LABELS[username] || "configured admin inbox";
  const confirmationEmailLabel = ADMIN_CONFIRMATION_EMAIL_LABELS[username] || "configured confirmation inbox";

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername) {
      setError("Please enter a username");
      return;
    }

    if (normalizedUsername !== "admin1") {
      setError("Invalid username. Use admin1");
      return;
    }

    setSendingOtp(true);

    try {
      const response = await fetch(apiUrl("/api/admin/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalizedUsername }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUsername(normalizedUsername);
        setOtpSent(true);
        toast.success("OTP codes sent successfully!");
        setError("");
      } else {
        setError(data.detail || "Failed to send OTP");
      }
    } catch (err) {
      setError("Failed to send OTP. Please try again.");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const normalizedOtp = otpCode.replace(/\D/g, "");
      const normalizedConfirmationOtp = confirmationOtpCode.replace(/\D/g, "");
      if (normalizedOtp.length !== 6 || normalizedConfirmationOtp.length !== 6) {
        setError("Please enter both OTP codes");
        setLoading(false);
        return;
      }

      const response = await fetch(apiUrl("/api/admin/verify-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          otp_code: normalizedOtp,
          confirmation_otp_code: normalizedConfirmationOtp,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sessionStorage.setItem("admin_token", data.access_token);
        sessionStorage.setItem("admin_logged_in", "true");
        sessionStorage.setItem("admin_username", username);
        sessionStorage.setItem("admin_id", data.admin_id || "admin-001");
        sessionStorage.setItem("admin_session_time", Date.now().toString());

        toast.success("Login successful!");
        navigate(from, { replace: true });
      } else {
        setError(data.detail || "Invalid OTP codes");
      }
    } catch (err) {
      setError("Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setSendingOtp(true);
    try {
      const response = await fetch(apiUrl("/api/admin/send-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success("New OTP codes sent!");
        setOtpCode("");
        setConfirmationOtpCode("");
      } else {
        setError(data.detail || "Failed to resend OTP");
      }
    } catch (err) {
      setError("Failed to resend OTP. Please try again.");
    } finally {
      setSendingOtp(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-aqua/30 to-secondary flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Admin Login</h1>
          <p className="text-muted-foreground mt-2">Secure authentication with double OTP verification</p>
        </div>

        <div className="rounded-xl border border-primary/10 bg-white/90 p-8 shadow-[0_22px_70px_-38px_hsl(var(--primary))] backdrop-blur">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter admin1"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Available username: admin1</p>
              </div>

              <Button type="submit" className="w-full" disabled={sendingOtp}>
                {sendingOtp ? "Sending OTP..." : "Send OTP Codes"}
                <Mail className="ml-2 h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="otp">Your OTP Code</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-lg tracking-widest"
                  required
                />
                <p className="text-xs text-muted-foreground">Sent to: {primaryEmailLabel}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmation-otp">Confirmation OTP Code</Label>
                <Input
                  id="confirmation-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit confirmation OTP"
                  value={confirmationOtpCode}
                  onChange={(e) => setConfirmationOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-lg tracking-widest"
                  required
                />
                <p className="text-xs text-muted-foreground">Sent to: {confirmationEmailLabel}</p>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verifying..." : "Verify & Login"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleResendOtp}
                disabled={sendingOtp}
              >
                {sendingOtp ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Resending...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Resend OTP Codes
                  </>
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            <p>Protected area. Authorized personnel only.</p>
            <p className="mt-1">Double OTP verification required.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
