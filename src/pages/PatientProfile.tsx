import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePatient } from "@/context/PatientContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
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
  const [pendingAction, setPendingAction] = useState<"phone" | "password_forgot" | "delete" | null>(null);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordOtpVerified, setForgotPasswordOtpVerified] = useState(false);

  const passwordChecks = getPasswordChecks(newPassword);
  const isNewPasswordStrong = Object.values(passwordChecks).every(Boolean);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // OTP Cooldown timer
  useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setTimeout(() => setOtpCooldown(otpCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpCooldown]);

  const verifyCurrentPassword = async () => {
    if (!loggedInEmail || !currentPassword) {
      setMessage({ text: "Please enter current password", type: "error" });
      return;
    }

    setVerifyingPassword(true);
    try {
      const response = await fetch("/api/auth/patient/verify-current-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_email: loggedInEmail,
          current_password: currentPassword
        }),
      });

      if (response.ok) {
        setPasswordVerified(true);
        setMessage({ text: "Password verified! You can now set a new password.", type: "success" });
      } else {
        const error = await response.json();
        setMessage({ text: error.detail || "Password is incorrect", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error. Please try again.", type: "error" });
    } finally {
      setVerifyingPassword(false);
    }
  };

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

  const sendProfileOtp = async (action: "phone" | "password_forgot" | "delete") => {
    if (!loggedInEmail) {
      setMessage({ text: "No logged-in user found", type: "error" });
      return;
    }

    if (action === "phone" && !phone.trim()) {
      setMessage({ text: "Please enter a new phone number", type: "error" });
      return;
    }

    if (action === "password_forgot") {
      if (!newPassword || newPassword !== confirmPassword) {
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
        setOtpCooldown(60); // Start 60 second cooldown
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
      } else if (pendingAction === "password_forgot") {
        // For forgot password: verify OTP and change password in one step
        const response = await fetch("/api/auth/patient/change-password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_password: "FORGOT_PASSWORD_PLACEHOLDER", // Special marker for forgot flow
            new_password: newPassword,
            patient_email: loggedInEmail,
            otp_code: otpCode,
          }),
        });

        if (response.ok) {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setShowForgotPassword(false);
          setForgotPasswordOtpVerified(false);
          setOtpDialogOpen(false);
          setOtpCode("");
          setPendingAction(null);
          setMessage({ text: "Password changed successfully!", type: "success" });
          setOtpSubmitting(false);
          return;
        } else {
          const error = await response.json();
          setMessage({ text: error.detail || "Invalid OTP or password error", type: "error" });
          setOtpSubmitting(false);
          return;
        }
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
      <div className="flex min-h-screen items-center justify-center bg-[#f5f3ee]">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      <header className="sticky top-0 z-50 border-b border-[#e6ded3] bg-[#fbfaf7]/90 backdrop-blur-xl">
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

      <main className="section-container px-4 py-6 md:px-8 md:py-10">
        <section className="rounded-[24px] bg-primary px-4 py-6 text-primary-foreground shadow-[0_24px_70px_-36px_rgba(31,92,84,0.9)] sm:rounded-[32px] sm:px-6 sm:py-8 md:px-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 sm:h-20 sm:w-20">
              <User className="h-7 w-7 sm:h-10 sm:w-10" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-primary-foreground/70 sm:text-sm sm:tracking-[0.22em]">Patient Account</p>
              <h1 className="mt-1 truncate font-display text-2xl font-bold sm:mt-2 sm:text-3xl md:text-4xl">
                {dbProfile ? dbProfile.name : profile.name}
              </h1>
              <p className="mt-1 truncate text-sm text-primary-foreground/75 sm:mt-2 sm:text-base">
                {dbProfile ? dbProfile.email : profile.email}
              </p>
            </div>
          </div>

          {dbProfile && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 md:grid-cols-4 md:gap-4">
              <ProfileStat label="Patient ID" value={dbProfile.patient_id} mono />
              <ProfileStat label="Phone" value={dbProfile.phone} />
              <ProfileStat label="Blood Group" value={dbProfile.blood_group || "N/A"} />
              <ProfileStat label="Member Since" value={new Date(dbProfile.created_at).toLocaleDateString()} />
            </div>
          )}
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-12 lg:gap-6">
          <div className="col-span-2 sm:col-span-1 lg:col-span-4">
            <ProfileCard icon={Phone} title="Change Phone Number" description="Update your contact number">
              <div className="flex gap-2">
                <div className="w-20">
                  <Label htmlFor="countryCode">Code</Label>
                  <Input
                    id="countryCode"
                    type="tel"
                    value="+91"
                    disabled
                    className="mt-2 bg-[#f0ede6]"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-2"
                  />
                </div>
              </div>
              <Button onClick={() => void sendProfileOtp("phone")} disabled={!phone || otpSending} className="w-full mt-4">
                {otpSending && pendingAction === "phone" ? "Sending OTP..." : "Verify OTP and Update"}
              </Button>
            </ProfileCard>
          </div>

          <div className="col-span-2 lg:col-span-7">
            <ProfileCard icon={Lock} title="Change Password" description="Update your account password">
              {!showForgotPassword ? (
                // Normal password change - verify current password first, no OTP
                <>
                  <div>
                    <Label htmlFor="current-pw">Current Password</Label>
                    <PasswordInput
                      id="current-pw"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setPasswordVerified(false);
                      }}
                      className="mt-2"
                    />
                  </div>
                  {passwordVerified ? (
                    // Password verified - show new password fields
                    <>
                      <div>
                        <Label htmlFor="new-pw">New Password</Label>
                        <PasswordInput id="new-pw" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-2" />
                      </div>
                      {newPassword && <PasswordRules checks={passwordChecks} />}
                      <div>
                        <Label htmlFor="confirm-pw">Confirm New Password</Label>
                        <PasswordInput id="confirm-pw" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2" />
                      </div>
                      <Button
                        onClick={async () => {
                          if (!loggedInEmail || !newPassword || !isNewPasswordStrong || newPassword !== confirmPassword) {
                            setMessage({ text: "Please fill all fields correctly", type: "error" });
                            return;
                          }
                          setVerifyingPassword(true);
                          try {
                            const response = await fetch("/api/auth/patient/change-password-direct", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                patient_email: loggedInEmail,
                                current_password: currentPassword,
                                new_password: newPassword,
                              }),
                            });
                            if (response.ok) {
                              setCurrentPassword("");
                              setNewPassword("");
                              setConfirmPassword("");
                              setPasswordVerified(false);
                              setMessage({ text: "Password changed successfully!", type: "success" });
                            } else {
                              const error = await response.json();
                              setMessage({ text: error.detail || "Failed to change password", type: "error" });
                            }
                          } catch {
                            setMessage({ text: "Network error", type: "error" });
                          } finally {
                            setVerifyingPassword(false);
                          }
                        }}
                        disabled={!newPassword || newPassword !== confirmPassword || !isNewPasswordStrong || verifyingPassword}
                        className="w-full mt-4"
                      >
                        {verifyingPassword ? "Changing..." : "Change Password"}
                      </Button>
                    </>
                  ) : (
                    <div className="flex gap-2 mt-4">
                      <Button
                        onClick={verifyCurrentPassword}
                        disabled={!currentPassword || verifyingPassword}
                        className="flex-1"
                      >
                        {verifyingPassword ? "Verifying..." : "Verify Password"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowForgotPassword(true)}
                      >
                        Forgot?
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                // Forgot password - send OTP, verify, and change password in one flow
                <>
                  <div>
                    <Label htmlFor="new-pw-forgot">New Password</Label>
                    <PasswordInput id="new-pw-forgot" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-2" />
                  </div>
                  {newPassword && <PasswordRules checks={passwordChecks} />}
                  <div>
                    <Label htmlFor="confirm-pw-forgot">Confirm New Password</Label>
                    <PasswordInput id="confirm-pw-forgot" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-2" />
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      onClick={() => void sendProfileOtp("password_forgot")}
                      disabled={!newPassword || newPassword !== confirmPassword || !isNewPasswordStrong || otpSending}
                      className="flex-1"
                    >
                      {otpSending ? "Sending..." : "Send OTP"}
                    </Button>
                    <Button variant="outline" onClick={() => { setShowForgotPassword(false); setForgotPasswordOtpVerified(false); setNewPassword(""); setConfirmPassword(""); }}>
                      Back
                    </Button>
                  </div>
                </>
              )}
            </ProfileCard>
          </div>

          <div className="col-span-2 lg:col-span-5">
            <ProfileCard icon={Trash2} title="Delete Account" description="Permanently delete your account and all data" danger>
              <div>
                <Label htmlFor="delete-pw">Enter Password to Confirm</Label>
                <PasswordInput
                  id="delete-pw"
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
            <DialogTitle>
              {pendingAction === "phone" ? "Verify OTP for Phone Change" :
               pendingAction === "password_forgot" ? "Verify OTP for Password Reset" :
               pendingAction === "delete" ? "Verify OTP for Account Deletion" :
               "Verify OTP"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "phone"
                ? `Enter the OTP sent to ${loggedInEmail} to verify your new phone number.`
                : pendingAction === "password_forgot"
                ? `Enter the OTP sent to ${loggedInEmail} to reset your password.`
                : pendingAction === "delete"
                ? `Enter the OTP sent to ${loggedInEmail} to delete your account. This action cannot be undone.`
                : `Enter the OTP sent to ${loggedInEmail} to continue.`
              }
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
            {otpCooldown > 0 ? (
              <Button variant="outline" disabled className="text-gray-400">
                Resend in {otpCooldown}s
              </Button>
            ) : (
              <Button variant="outline" onClick={() => pendingAction && void sendProfileOtp(pendingAction)} disabled={otpSending || otpSubmitting || !pendingAction}>
                {otpSending ? "Sending..." : "Resend OTP"}
              </Button>
            )}
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
  <div className="space-y-2 rounded-2xl bg-[#f0ede6] p-4">
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

const ProfileStat = ({ label, value, mono = false, className = "" }: { label: string; value: string; mono?: boolean; className?: string }) => (
  <div className={`rounded-[18px] bg-white/10 px-3 py-3 sm:rounded-[22px] sm:px-4 sm:py-4 ${className}`}>
    <p className="text-xs text-primary-foreground/70 sm:text-sm">{label}</p>
    <p className={`mt-1 break-words text-sm font-bold leading-tight text-white sm:mt-2 sm:text-lg ${mono ? "font-mono" : ""}`}>{value}</p>
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
  <div className={`rounded-[20px] border p-4 shadow-sm sm:rounded-[28px] sm:p-6 ${danger ? "border-red-200 bg-red-50/50" : "border-[#e6ded3] bg-[#fbfaf7]"}`}>
    <div className="mb-4 flex items-center gap-3 sm:mb-6">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-12 sm:w-12 sm:rounded-2xl ${danger ? "bg-red-100 text-red-600" : "bg-[#f0ede6] text-primary"}`}>
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-bold leading-tight text-foreground sm:text-xl">{title}</h2>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:text-sm">{description}</p>
      </div>
    </div>
    <div className="space-y-3 sm:space-y-4">{children}</div>
  </div>
);

export default PatientProfile;
