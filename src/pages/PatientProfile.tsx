import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, CheckCircle, Lock, LogOut, Phone, Trash2, User, XCircle } from "lucide-react";

const getPasswordChecks = (password: string) => ({
  length: password.length >= 8,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
});

const PatientProfile = () => {
  const navigate = useNavigate();
  const { profile } = usePatient();
  const [dbProfile, setDbProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const getLoggedInEmail = () => {
    try {
      const userStr = localStorage.getItem("user");
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.email;
      }
    } catch (error) {
      console.error("Error getting user from localStorage:", error);
    }
    return null;
  };

  const loggedInEmail = getLoggedInEmail();

  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"phone" | "password" | "delete" | null>(null);

  const passwordChecks = getPasswordChecks(newPassword);
  const isNewPasswordStrong = Object.values(passwordChecks).every(Boolean);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const refreshPatientProfile = async () => {
    if (!loggedInEmail) return;

    const response = await fetch(`/api/auth/patient/data?email=${loggedInEmail}`);
    if (response.ok) {
      const data = await response.json();
      setDbProfile(data);
      setPhone(data.phone || "");
    }
  };

  useEffect(() => {
    const fetchPatientData = async () => {
      if (!loggedInEmail) {
        console.error("No logged-in user found");
        setLoading(false);
        return;
      }

      try {
        await refreshPatientProfile();
      } catch (error) {
        console.error("Failed to fetch patient data:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchPatientData();
  }, [loggedInEmail]);

  const handleLogout = () => {
    localStorage.removeItem("krama_patient_profile");
    localStorage.removeItem("krama_active_appointment");
    localStorage.removeItem("krama_visit_history");
    localStorage.removeItem("user");
    navigate("/");
  };

  const sendProfileOtp = async (action: "phone" | "password" | "delete") => {
    if (!loggedInEmail) {
      setMessage({ text: "No logged-in user found", type: "error" });
      return;
    }

    if (action === "phone" && !phone.trim()) {
      setMessage({ text: "Please enter a new phone number", type: "error" });
      return;
    }

    if (action === "password") {
      if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
        setMessage({ text: "Please fill all password fields correctly", type: "error" });
        return;
      }

      if (!isNewPasswordStrong) {
        setMessage({ text: "New password must match the signup password rules", type: "error" });
        return;
      }
    }

    if (action === "delete") {
      if (!deletePassword) {
        setMessage({ text: "Please enter your password to delete account", type: "error" });
        return;
      }

      if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
        return;
      }
    }

    setOtpSending(true);
    try {
      const response = await fetch("/api/auth/patient/send-profile-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_email: loggedInEmail }),
      });

      if (response.ok) {
        setPendingAction(action);
        setOtpCode("");
        setOtpDialogOpen(true);
        setMessage({ text: "OTP sent to your email", type: "success" });
      } else {
        const error = await response.json();
        setMessage({ text: error.detail || "Failed to send OTP", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error. Please try again.", type: "error" });
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifiedAction = async () => {
    if (!loggedInEmail || !pendingAction) {
      setMessage({ text: "No pending action found", type: "error" });
      return;
    }

    if (!otpCode.trim()) {
      setMessage({ text: "Please enter the OTP", type: "error" });
      return;
    }

    setOtpSubmitting(true);
    try {
      let response: Response;

      if (pendingAction === "phone") {
        response = await fetch("/api/auth/patient/change-phone", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            new_phone: phone,
            patient_email: loggedInEmail,
            otp_code: otpCode,
          }),
        });
      } else if (pendingAction === "password") {
        response = await fetch("/api/auth/patient/change-password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
            patient_email: loggedInEmail,
            otp_code: otpCode,
          }),
        });
      } else {
        response = await fetch("/api/auth/patient/delete-account", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: deletePassword,
            confirmation: "DELETE",
            patient_email: loggedInEmail,
            otp_code: otpCode,
          }),
        });
      }

      if (!response.ok) {
        const error = await response.json();
        setMessage({ text: error.detail || "Action failed", type: "error" });
        return;
      }

      if (pendingAction === "phone") {
        await refreshPatientProfile();
        setMessage({ text: "Phone number updated successfully!", type: "success" });
      } else if (pendingAction === "password") {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage({ text: "Password changed successfully!", type: "success" });
      } else {
        setMessage({ text: "Account deleted successfully!", type: "success" });
        localStorage.clear();
        navigate("/");
        return;
      }

      setOtpDialogOpen(false);
      setOtpCode("");
      setPendingAction(null);
    } catch {
      setMessage({ text: "Network error. Please try again.", type: "error" });
    } finally {
      setOtpSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="section-container flex h-16 items-center gap-3 px-4 md:px-8">
          <Link to="/patient" className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <span className="text-sm font-semibold text-foreground">Patient Profile</span>
        </div>
      </header>

      {message && (
        <div
          className={`fixed right-4 top-20 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${
            message.type === "success" ? "bg-primary text-white" : "bg-red-600 text-white"
          }`}
        >
          {message.text}
        </div>
      )}

      <main className="section-container px-4 py-8 md:px-8 md:py-10">
        <section className="rounded-[32px] bg-primary px-6 py-8 text-primary-foreground shadow-[0_24px_70px_-36px_rgba(31,92,84,0.9)] md:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
              <User className="h-10 w-10" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.22em] text-primary-foreground/70">Account</p>
              <h1 className="mt-2 font-display text-3xl font-bold md:text-4xl">
                {dbProfile ? dbProfile.name : profile.name}
              </h1>
              <p className="mt-2 text-primary-foreground/75">
                {dbProfile ? dbProfile.email : profile.email}
              </p>
            </div>
          </div>

          {dbProfile && (
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <ProfileStat label="Patient ID" value={dbProfile.patient_id} mono />
              <ProfileStat label="Phone" value={dbProfile.phone} />
              <ProfileStat label="Member Since" value={new Date(dbProfile.created_at).toLocaleDateString()} />
            </div>
          )}
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProfileCard icon={Phone} title="Change Phone Number" description="Update your contact number">
            <div>
              <Label htmlFor="phone">New Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+91 98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-2"
              />
            </div>
            <Button onClick={() => void sendProfileOtp("phone")} disabled={!phone || otpSending} className="w-full">
              {otpSending && pendingAction === "phone" ? "Sending OTP..." : "Verify OTP and Update"}
            </Button>
          </ProfileCard>

          <ProfileCard icon={Lock} title="Change Password" description="Update your account password">
            <div>
              <Label htmlFor="current-pw">Current Password</Label>
              <Input id="current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="mt-2" />
            </div>
            <div>
              <Label htmlFor="new-pw">New Password</Label>
              <Input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-2" />
            </div>
            {newPassword && <PasswordRules checks={passwordChecks} />}
            <div>
              <Label htmlFor="confirm-pw">Confirm New Password</Label>
              <Input id="confirm-pw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2" />
            </div>
            <Button
              onClick={() => void sendProfileOtp("password")}
              disabled={!currentPassword || !newPassword || newPassword !== confirmPassword || !isNewPasswordStrong || otpSending}
              className="w-full"
            >
              Verify OTP and Change Password
            </Button>
          </ProfileCard>

          <div className="lg:col-span-2">
            <ProfileCard icon={Trash2} title="Delete Account" description="Permanently delete your account and all data" danger>
              <div>
                <Label htmlFor="delete-pw">Enter Password to Confirm</Label>
                <Input
                  id="delete-pw"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your password"
                  className="mt-2"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void sendProfileOtp("delete")} disabled={!deletePassword || otpSending} className="bg-red-600 text-white hover:bg-red-700">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Verify OTP and Delete
                </Button>
                <Button variant="outline" onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </ProfileCard>
          </div>
        </section>
      </main>

      <Dialog
        open={otpDialogOpen}
        onOpenChange={(open) => {
          setOtpDialogOpen(open);
          if (!open) {
            setOtpCode("");
            setPendingAction(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify OTP</DialogTitle>
            <DialogDescription>
              Enter the OTP sent to {loggedInEmail} to continue.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="profile-otp">OTP Code</Label>
            <Input
              id="profile-otp"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter 6-digit OTP"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => pendingAction && void sendProfileOtp(pendingAction)} disabled={otpSending || otpSubmitting || !pendingAction}>
              Resend OTP
            </Button>
            <Button onClick={() => void handleVerifiedAction()} disabled={!otpCode || otpSubmitting}>
              {otpSubmitting ? "Verifying..." : "Verify and Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PasswordRules = ({ checks }: { checks: ReturnType<typeof getPasswordChecks> }) => (
  <div className="space-y-2 rounded-2xl bg-secondary/60 p-4">
    <p className="text-xs text-muted-foreground">Password must contain:</p>
    <PasswordRule ok={checks.length} text="At least 8 characters" />
    <PasswordRule ok={checks.uppercase} text="One uppercase letter (A-Z)" />
    <PasswordRule ok={checks.lowercase} text="One lowercase letter (a-z)" />
    <PasswordRule ok={checks.number} text="One number (0-9)" />
    <PasswordRule ok={checks.special} text="One special character" />
  </div>
);

const PasswordRule = ({ ok, text }: { ok: boolean; text: string }) => (
  <div className="flex items-center text-xs text-foreground">
    {ok ? <CheckCircle className="mr-2 h-3.5 w-3.5 text-green-500" /> : <XCircle className="mr-2 h-3.5 w-3.5 text-red-500" />}
    {text}
  </div>
);

const ProfileStat = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div className="rounded-[22px] bg-white/10 px-4 py-4">
    <p className="text-sm text-primary-foreground/70">{label}</p>
    <p className={`mt-2 text-lg font-bold text-white ${mono ? "font-mono" : ""}`}>{value}</p>
  </div>
);

const ProfileCard = ({
  icon: Icon,
  title,
  description,
  children,
  danger = false,
}: {
  icon: any;
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) => (
  <div className={`rounded-[28px] border p-6 shadow-sm ${danger ? "border-red-200 bg-red-50/50" : "border-border/70 bg-white"}`}>
    <div className="mb-6 flex items-center gap-3">
      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${danger ? "bg-red-100 text-red-600" : "bg-secondary text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

export default PatientProfile;
