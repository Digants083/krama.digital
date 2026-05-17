import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Mail, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
  const from = (location.state as any)?.from?.pathname || "/admin/dashboard";

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Please enter a username");
      return;
    }

    if (username !== "admin1" && username !== "admin2") {
      setError("Invalid username. Use admin1 or admin2");
      return;
    }

    setSendingOtp(true);

    try {
      const response = await fetch("/api/admin/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
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
      if (!otpCode.trim() || !confirmationOtpCode.trim()) {
        setError("Please enter both OTP codes");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/admin/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          otp_code: otpCode,
          confirmation_otp_code: confirmationOtpCode,
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
      const response = await fetch("/api/admin/send-otp", {
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
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">Admin Login</h1>
          <p className="text-slate-600 mt-2">Secure authentication with double OTP verification</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
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
                  placeholder="Enter admin1 or admin2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <p className="text-xs text-slate-500">Available usernames: admin1, admin2</p>
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
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="text-center text-lg tracking-widest"
                  required
                />
                <p className="text-xs text-slate-500">
                  {username === "admin1" ? "Sent to: diganths083@gmail.com" : "Sent to: yashavanthb28@gmail.com"}
                </p>
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
                  onChange={(e) => setConfirmationOtpCode(e.target.value)}
                  className="text-center text-lg tracking-widest"
                  required
                />
                <p className="text-xs text-slate-500">Sent to: digitalkrama@gmail.com</p>
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
