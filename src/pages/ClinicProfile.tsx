import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { ArrowLeft, Phone, Lock, Trash2, LogOut, Building2, QrCode, MapPin, ImagePlus, X, Download, CheckCircle, XCircle, UserPlus, Stethoscope, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const getPasswordChecks = (password: string) => ({
  length: password.length >= 8,
  uppercase: /[A-Z]/.test(password),
  lowercase: /[a-z]/.test(password),
  number: /[0-9]/.test(password),
  special: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
});

const ClinicProfile = () => {
  const navigate = useNavigate();
  const [dbProfile, setDbProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const getLoggedInClinicId = () => {
    try {
      return localStorage.getItem("clinic_id");
    } catch (error) {
      console.error("Error getting clinic ID from localStorage:", error);
    }
    return null;
  };

  const loggedInClinicId = getLoggedInClinicId();

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  // Structured address fields
  const [streetAddress, setStreetAddress] = useState("");
  const [road, setRoad] = useState("");
  const [layout, setLayout] = useState("");
  const [section, setSection] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [locationCoords, setLocationCoords] = useState<{ latitude: string; longitude: string } | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{ url: string; index: number } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [pendingAction, setPendingAction] = useState<"phone" | "password" | "password_forgot" | "delete" | "address" | null>(null);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordOtpVerified, setForgotPasswordOtpVerified] = useState(false);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [newDoctor, setNewDoctor] = useState({ name: "", specialization: "", experience: "", qualifications: "" });

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

  useEffect(() => {
    const fetchClinicData = async () => {
      if (!loggedInClinicId) {
        setMessage({ text: "No logged-in clinic found", type: "error" });
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/auth/clinic/data?clinic_id=${loggedInClinicId}`);
        if (response.ok) {
          const data = await response.json();
          setDbProfile(data);
          setPhone(data.phone || "");
          setAddress(data.full_formatted_address || data.address || "");
          setLocationCoords(
            data.latitude && data.longitude
              ? { latitude: data.latitude, longitude: data.longitude }
              : null
          );
          setImageUrls(data.image_urls || []);
          setDoctors(data.doctors || []);
        } else {
          setMessage({ text: "Failed to fetch clinic data", type: "error" });
        }
      } catch (error) {
        setMessage({ text: "Network error. Please try again.", type: "error" });
      } finally {
        setLoading(false);
      }
    };

    void fetchClinicData();
  }, [loggedInClinicId]);

  const refreshClinicProfile = async () => {
    if (!loggedInClinicId) {
      return;
    }

    const response = await fetch(`/api/auth/clinic/data?clinic_id=${loggedInClinicId}`);
    if (!response.ok) return;

    const data = await response.json();
    setDbProfile(data);
    setPhone(data.phone || "");
    setAddress(data.full_formatted_address || data.address || "");
    setLocationCoords(
      data.latitude && data.longitude
        ? { latitude: data.latitude, longitude: data.longitude }
        : null
    );
    setImageUrls(data.image_urls || []);
    setDoctors(data.doctors || []);
  };

  const addDoctor = async () => {
    if (!loggedInClinicId || !newDoctor.name.trim()) {
      setMessage({ text: "Doctor name is required", type: "error" });
      return;
    }
    try {
      const response = await fetch("/api/auth/clinic/doctors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: loggedInClinicId, ...newDoctor }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ text: data.detail || "Failed to add doctor", type: "error" });
        return;
      }
      setNewDoctor({ name: "", specialization: "", experience: "", qualifications: "" });
      setMessage({ text: "Doctor added", type: "success" });
      await refreshClinicProfile();
    } catch {
      setMessage({ text: "Network error. Please try again.", type: "error" });
    }
  };

  const verifyCurrentPassword = async () => {
    if (!loggedInClinicId || !currentPassword) {
      setMessage({ text: "Please enter current password", type: "error" });
      return;
    }

    setVerifyingPassword(true);
    try {
      const response = await fetch("/api/auth/clinic/verify-current-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: loggedInClinicId,
          password: currentPassword,
        }),
      });

      if (response.ok) {
        setPasswordVerified(true);
        setMessage({ text: "Password verified! Enter new password.", type: "success" });
      } else {
        const error = await response.json();
        setMessage({ text: error.detail || "Current password is incorrect", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error. Please try again.", type: "error" });
    } finally {
      setVerifyingPassword(false);
    }
  };

  const sendProfileOtp = async (action: "phone" | "password" | "password_forgot" | "delete" | "address") => {
    if (!loggedInClinicId) {
      setMessage({ text: "No logged-in clinic found", type: "error" });
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
        setMessage({ text: "Password required to delete account", type: "error" });
        return;
      }
      if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
        return;
      }
    }

    if (action === "address" && (!streetAddress || !road || !city || !pincode)) {
      setMessage({ text: "Please complete the required address fields", type: "error" });
      return;
    }

    setOtpSending(true);
    try {
      const response = await fetch("/api/auth/clinic/send-profile-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: loggedInClinicId }),
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      const availableSlots = 5 - imageUrls.length;
      const filesToUpload = files.slice(0, availableSlots);
      const MAX_SIZE = 5 * 1024 * 1024;
      const oversized = filesToUpload.filter((f) => f.size > MAX_SIZE);
      if (oversized.length > 0) {
        setMessage({ text: `${oversized[0].name} is above 5MB`, type: "error" });
        return;
      }
      setSelectedFiles(filesToUpload);
    }
  };

  const handleUploadImage = async () => {
    if (selectedFiles.length === 0 || !loggedInClinicId) {
      setMessage({ text: "Please select files first", type: "error" });
      return;
    }

    if (imageUrls.length >= 5) {
      setMessage({ text: "Maximum 5 images allowed", type: "error" });
      return;
    }

    setUploading(true);
    let uploadedCount = 0;
    let failedCount = 0;

    for (const file of selectedFiles) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clinic_id", loggedInClinicId);

      try {
        const response = await fetch("/api/auth/clinic/upload-image", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          uploadedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        failedCount++;
      }
    }

    setUploading(false);
    setSelectedFiles([]);

    if (uploadedCount > 0) {
      const dataResponse = await fetch(`/api/auth/clinic/data?clinic_id=${loggedInClinicId}`);
      if (dataResponse.ok) {
        const profileData = await dataResponse.json();
        setImageUrls(profileData.image_urls || []);
        setDbProfile(profileData);
        setMessage({ text: `${uploadedCount} image(s) uploaded successfully!`, type: "success" });
      }
    }
    if (failedCount > 0) {
      setMessage({ text: `${failedCount} image(s) failed to upload`, type: "error" });
    }
  };

  const handleRemoveImage = async (index: number) => {
    if (!loggedInClinicId) return;

    try {
      const response = await fetch(`/api/auth/clinic/image/${loggedInClinicId}/${index}`, {
        method: "DELETE",
      });

      if (response.ok) {
        window.location.reload();
      } else {
        setMessage({ text: "Failed to delete image", type: "error" });
      }
    } catch (error) {
      setMessage({ text: "Error deleting image", type: "error" });
    }
  };

  const handleUpdateProfile = async (verifiedOtpCode?: string) => {
    if (!loggedInClinicId) {
      setMessage({ text: "No logged-in clinic found", type: "error" });
      return false;
    }

    try {
      const payload: Record<string, unknown> = {
        clinic_id: loggedInClinicId,
        image_urls: imageUrls,
      };

      if (verifiedOtpCode) {
        payload.address = address || dbProfile?.address;
        payload.street_address = streetAddress || dbProfile?.street_address;
        payload.road = road || dbProfile?.road;
        payload.layout = layout || dbProfile?.layout;
        payload.section = section || dbProfile?.section;
        payload.city = city || dbProfile?.city;
        payload.pincode = pincode || dbProfile?.pincode;
        payload.otp_code = verifiedOtpCode;
      }

      const response = await fetch("/api/auth/clinic/update-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        if (verifiedOtpCode) {
          setMessage({
            text: "Address updated. Set the exact map pin from the clinic dashboard.",
            type: "success"
          });
          setLocationCoords(null);
        } else {
          setMessage({ text: "Profile updated successfully!", type: "success" });
        }
        await refreshClinicProfile();
        return true;
      } else {
        const error = await response.json();
        setMessage({ text: error.detail || "Failed to update profile", type: "error" });
        return false;
      }
    } catch (error) {
      setMessage({ text: "Network error. Please try again.", type: "error" });
      return false;
    }
  };

  const handleVerifiedAction = async () => {
    if (!loggedInClinicId || !pendingAction) {
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
        response = await fetch("/api/auth/clinic/change-phone", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: loggedInClinicId,
            new_phone: phone,
            otp_code: otpCode,
          }),
        });
      } else if (pendingAction === "password") {
        response = await fetch("/api/auth/clinic/change-password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: loggedInClinicId,
            current_password: currentPassword,
            new_password: newPassword,
            otp_code: otpCode,
          }),
        });
      } else if (pendingAction === "password_forgot") {
        // For forgot password: verify OTP and change password in one step (no current password needed)
        response = await fetch("/api/auth/clinic/change-password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: loggedInClinicId,
            current_password: "FORGOT_PASSWORD_PLACEHOLDER",
            new_password: newPassword,
            otp_code: otpCode,
          }),
        });
      } else if (pendingAction === "address") {
        const success = await handleUpdateProfile(otpCode);
        if (success) {
          setOtpDialogOpen(false);
          setOtpCode("");
          setPendingAction(null);
        }
        return;
      } else {
        response = await fetch("/api/auth/clinic/delete", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: loggedInClinicId,
            password: deletePassword,
            confirmation: "DELETE",
            otp_code: otpCode,
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        setMessage({ text: errorData.detail || "Action failed", type: "error" });
        return;
      }

      if (pendingAction === "phone") {
        setMessage({ text: "Phone number updated successfully!", type: "success" });
        await refreshClinicProfile();
      } else if (pendingAction === "password") {
        setMessage({ text: "Password changed successfully!", type: "success" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else if (pendingAction === "password_forgot") {
        setMessage({ text: "Password reset successfully!", type: "success" });
        setNewPassword("");
        setConfirmPassword("");
        setShowForgotPassword(false);
        setForgotPasswordOtpVerified(false);
      } else {
        setMessage({ text: "Account deleted successfully", type: "success" });
        localStorage.clear();
        navigate("/clinic/login");
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

  const handleLogout = () => {
    localStorage.removeItem("krama_patient_profile");
    localStorage.removeItem("krama_active_appointment");
    localStorage.removeItem("krama_visit_history");
    localStorage.removeItem("user");
    localStorage.removeItem("clinic_id");
    sessionStorage.removeItem("clinic_access_token");
    navigate("/");
  };

  const getClinicQrUrl = () => {
    if (!dbProfile?.clinic_id) return "";
    return `${window.location.origin}/join?clinic_id=${dbProfile.clinic_id}`;
  };

  const downloadClinicQr = async () => {
    const clinicQrUrl = getClinicQrUrl();
    if (!clinicQrUrl) return;

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(clinicQrUrl)}`;

    try {
      const response = await fetch(qrImageUrl);
      if (!response.ok) {
        setMessage({ text: "Failed to download QR code", type: "error" });
        return;
      }

      const qrBlob = await response.blob();
      const qrObjectUrl = URL.createObjectURL(qrBlob);

      const qrImg = new Image();
      qrImg.src = qrObjectUrl;

      await new Promise<void>((resolve, reject) => {
        qrImg.onload = () => resolve();
        qrImg.onerror = () => reject(new Error("Failed to load QR image"));
      });

      // A4 portrait at ~150dpi: 1240x1754
      const width = 1240;
      const height = 1754;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(qrObjectUrl);
        setMessage({ text: "Failed to generate QR sheet", type: "error" });
        return;
      }

      // Background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);

      // Header: KRAMA
      ctx.fillStyle = "#00555A";
      ctx.font = "bold 64px Arial";
      ctx.textAlign = "center";
      ctx.fillText("KRAMA", width / 2, 140);

      // Clinic name
      ctx.fillStyle = "#0F172A";
      ctx.font = "bold 42px Arial";
      const clinicName = dbProfile?.clinic_name || "Clinic";
      ctx.fillText(clinicName, width / 2, 220);

      // Doctor name
      ctx.fillStyle = "#334155";
      ctx.font = "28px Arial";
      const doctorName = dbProfile?.doctor_name || "Doctor";
      ctx.fillText(doctorName, width / 2, 270);

      // QR placement
      const qrSize = 720;
      const qrX = (width - qrSize) / 2;
      const qrY = 420;

      // QR border card
      ctx.fillStyle = "#F8FAFC";
      const cardPad = 30;
      const cardX = qrX - cardPad;
      const cardY = qrY - cardPad;
      const cardW = qrSize + cardPad * 2;
      const cardH = qrSize + cardPad * 2;

      const r = 24;
      ctx.beginPath();
      ctx.moveTo(cardX + r, cardY);
      ctx.lineTo(cardX + cardW - r, cardY);
      ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + r);
      ctx.lineTo(cardX + cardW, cardY + cardH - r);
      ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - r, cardY + cardH);
      ctx.lineTo(cardX + r, cardY + cardH);
      ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - r);
      ctx.lineTo(cardX, cardY + r);
      ctx.quadraticCurveTo(cardX, cardY, cardX + r, cardY);
      ctx.closePath();
      ctx.fill();

      // Draw QR
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // Overlay KRAMA in center of QR
      const badgeW = 200;
      const badgeH = 56;
      const badgeX = width / 2 - badgeW / 2;
      const badgeY = qrY + qrSize / 2 - badgeH / 2;

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      const br = 10;
      ctx.beginPath();
      ctx.moveTo(badgeX + br, badgeY);
      ctx.lineTo(badgeX + badgeW - br, badgeY);
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + br);
      ctx.lineTo(badgeX + badgeW, badgeY + badgeH - br);
      ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - br, badgeY + badgeH);
      ctx.lineTo(badgeX + br, badgeY + badgeH);
      ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - br);
      ctx.lineTo(badgeX, badgeY + br);
      ctx.quadraticCurveTo(badgeX, badgeY, badgeX + br, badgeY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#00555A";
      ctx.font = "bold 28px Arial";
      ctx.textAlign = "center";
      ctx.fillText("KRAMA", width / 2, badgeY + 38);

      // Footer
      ctx.fillStyle = "#64748B";
      ctx.font = "22px Arial";
      ctx.fillText("Scan to join the queue", width / 2, 1240);
      ctx.font = "18px Arial";
      const clinicIdLine = `Clinic ID: ${dbProfile?.clinic_id || ""}`;
      ctx.fillText(clinicIdLine, width / 2, 1280);

      URL.revokeObjectURL(qrObjectUrl);

      canvas.toBlob((outBlob) => {
        if (!outBlob) {
          setMessage({ text: "Failed to generate QR sheet", type: "error" });
          return;
        }

        const outUrl = URL.createObjectURL(outBlob);
        const a = document.createElement("a");
        a.href = outUrl;
        a.download = `${dbProfile?.clinic_id || "clinic"}-qr-a4.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(outUrl);
      }, "image/png");
    } catch (error) {
      setMessage({ text: "Failed to download QR code", type: "error" });
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
    <div className="min-h-screen bg-transparent">
      <header className="sticky top-0 z-50 border-b border-white/70 bg-white/80/90 backdrop-blur-xl">
        <div className="section-container flex h-16 items-center gap-3 px-4 md:px-8">
          <Link to="/clinic" className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <span className="text-sm font-semibold text-foreground">Clinic Profile</span>
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

      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <section className="motion-rise motion-shimmer overflow-hidden rounded-[30px] bg-[#143b34] p-4 text-white shadow-[0_26px_70px_-42px_rgba(31,92,84,0.95)] sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <Building2 className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Clinic Account</p>
              <h1 className="mt-1 truncate font-display text-3xl font-bold">
                {dbProfile?.clinic_name || "Clinic"}
              </h1>
              <p className="mt-1 truncate text-sm text-white/70">{dbProfile?.email || "clinic@example.com"}</p>
            </div>
          </div>

          {dbProfile && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ProfileStat label="Clinic ID" value={dbProfile.clinic_id} mono />
              <ProfileStat label="Phone" value={dbProfile.phone} />
              
            </div>
          )}
        </section>

        <section className="motion-rise-delayed grid gap-3">
          <div >
            <ProfileCard icon={UserPlus} title="Doctors" description="Add and manage doctors for this clinic">
              {doctors.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {doctors.map((doctor) => (
                    <div key={doctor.doctor_id || doctor.name} className="rounded-xl border border-[#e6ded3] bg-white/60 p-3">
                      <div className="flex items-center gap-2">
                        <Stethoscope className="h-4 w-4 text-primary" />
                        <p className="font-semibold text-foreground">{doctor.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{doctor.specialization || "General"}</p>
                      {doctor.experience && <p className="mt-1 text-xs text-muted-foreground">{doctor.experience} years experience</p>}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input placeholder="Doctor name" value={newDoctor.name} onChange={(e) => setNewDoctor({ ...newDoctor, name: e.target.value })} />
                <Input placeholder="Specialization" value={newDoctor.specialization} onChange={(e) => setNewDoctor({ ...newDoctor, specialization: e.target.value })} />
                <Input placeholder="Experience" value={newDoctor.experience} onChange={(e) => setNewDoctor({ ...newDoctor, experience: e.target.value })} />
                <Input placeholder="Qualifications" value={newDoctor.qualifications} onChange={(e) => setNewDoctor({ ...newDoctor, qualifications: e.target.value })} />
              </div>
              <Button onClick={() => void addDoctor()} className="w-full sm:w-auto">
                <UserPlus className="mr-2 h-4 w-4" />
                Add Doctor
              </Button>
            </ProfileCard>
          </div>

          <div >
            <ProfileCard icon={Phone} title="Change Phone Number" description="Update your contact number">
              <div className="grid grid-cols-[82px_1fr] gap-2">
                <div>
                  <Label htmlFor="countryCode">Code</Label>
                  <Input
                    id="countryCode"
                    type="tel"
                    value="+91"
                    disabled
                    className="mt-2 bg-[#f0ede6]"
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" type="tel" placeholder="9876543210" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2" />
                </div>
              </div>
              <Button onClick={() => void sendProfileOtp("phone")} disabled={!phone || otpSending} className="w-full mt-4">
                Verify OTP and Update
              </Button>
            </ProfileCard>
          </div>

          <div >
            <ProfileCard icon={MapPin} title="Change Address" description="Update clinic location">
              <div className="rounded-[18px] bg-[#f6f1e8] p-4 text-sm text-foreground">
                <p className="text-muted-foreground">Current Address</p>
                <p className="mt-1 font-medium">{dbProfile?.full_formatted_address || dbProfile?.address || "Not set"}</p>
                {locationCoords ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Coordinates: {locationCoords.latitude}, {locationCoords.longitude}
                  </p>
                ) : (
                  <p className="mt-1 text-xs font-medium text-amber-600">
                    Location not pinned. Please pin your location on the map.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Clinic Address Details</p>

                <div>
                  <Label htmlFor="street_address" className="text-xs">Street / Building Number *</Label>
                  <Input id="street_address" placeholder="#123, ABC Building" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} className="mt-1" />
                </div>

                <div>
                  <Label htmlFor="road" className="text-xs">Road / Street Name *</Label>
                  <Input id="road" placeholder="Main Road, MG Road" value={road} onChange={(e) => setRoad(e.target.value)} className="mt-1" />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="layout" className="text-xs">Layout / Area (Optional)</Label>
                    <Input id="layout" placeholder="Vidyaranyapura" value={layout} onChange={(e) => setLayout(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="section" className="text-xs">Section / Block (Optional)</Label>
                    <Input id="section" placeholder="A Block, 1st Stage" value={section} onChange={(e) => setSection(e.target.value)} className="mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="city" className="text-xs">City *</Label>
                    <Input id="city" placeholder="Bangalore" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="pincode" className="text-xs">Pincode *</Label>
                    <Input id="pincode" placeholder="560001" value={pincode} onChange={(e) => setPincode(e.target.value)} className="mt-1" />
                  </div>
                </div>
              </div>

              <Button onClick={() => void sendProfileOtp("address")} disabled={!streetAddress || !road || !city || !pincode || otpSending} className="w-full">
                Verify OTP and Update Address
              </Button>
            </ProfileCard>
          </div>

          <div >
            <ProfileCard icon={ImagePlus} title="Clinic Images" description="Upload and manage up to 5 images">
              {imageUrls.filter(Boolean).length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {imageUrls.map((url, idx) =>
                    url ? (
                      <div key={idx} className="relative">
                        <button
                          type="button"
                          onClick={() => setExpandedImage({ url, index: idx })}
                          className="block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                          title={`Preview clinic image ${idx + 1}`}
                        >
                          <img src={`/api${url}`} alt={`Clinic ${idx + 1}`} className="h-20 w-full object-cover transition hover:scale-105" />
                        </button>
                        <button
                          onClick={() => handleRemoveImage(idx)}
                          className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                          title="Remove image"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {imageUrls.length < 5 && (
                <div className="space-y-3">
                  <input type="file" id="file-upload" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
                  <label
                    htmlFor="file-upload"
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/70 bg-white/80 px-3 py-3 text-center transition hover:bg-[#f0ede6] sm:justify-start sm:px-4"
                  >
                    <ImagePlus className="h-5 w-5 text-primary" />
                    <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
                      {selectedFiles.length > 0 ? `${selectedFiles.length} image(s) selected` : "Choose from phone gallery"}
                    </span>
                  </label>
                  <Button onClick={handleUploadImage} variant="outline" disabled={selectedFiles.length === 0 || uploading} className="w-full">
                    {uploading ? "Uploading..." : "Upload Images"}
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">{imageUrls.length}/5 images stored</p>
              <Button onClick={() => void handleUpdateProfile()} className="w-full">
                Save Images
              </Button>
            </ProfileCard>
          </div>

          <div >
            <ProfileCard icon={QrCode} title="QR Code" description="Show QR code for patients to join queue">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-[24px] border border-white/70 bg-[#143b34] p-4 text-white shadow-[0_18px_54px_-42px_rgba(19,55,50,0.9)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                      <QrCode className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black">Quick access for patients</p>
                      <p className="mt-1 text-sm leading-5 text-white/70">Scan, choose a slot, and get a token.</p>
                    </div>
                  </div>
                </div>
                <Button onClick={() => setShowQrDialog(true)} className="w-full rounded-2xl bg-primary py-6 text-white hover:bg-primary/90">
                  <QrCode className="mr-2 h-4 w-4" />
                  Show QR Code
                </Button>
              </div>
            </ProfileCard>
          </div>

          <div >
            <ProfileCard icon={Lock} title="Change Password" description="Update your account password">
              {!showForgotPassword ? (
                // Normal password change - verify current password first
                <>
                  <div>
                    <Label htmlFor="current-pw">Current Password</Label>
                    <PasswordInput 
                      id="current-pw" 
                      value={currentPassword} 
                      onChange={(e) => setCurrentPassword(e.target.value)} 
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
                          if (!newPassword || !isNewPasswordStrong || newPassword !== confirmPassword) {
                            setMessage({ text: "Please fill all fields correctly", type: "error" });
                            return;
                          }
                          setVerifyingPassword(true);
                          try {
                            const response = await fetch("/api/auth/clinic/change-password-direct", {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                clinic_id: loggedInClinicId,
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
                        disabled={!newPassword || !isNewPasswordStrong || newPassword !== confirmPassword || verifyingPassword}
                        className="w-full mt-4"
                      >
                        {verifyingPassword ? "Changing..." : "Change Password"}
                      </Button>
                    </>
                  ) : (
                    <div className="flex gap-2 mt-4">
                      <Button
                        onClick={() => void verifyCurrentPassword()}
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
                // Forgot password - use OTP to reset
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

          <div >
            <ProfileCard icon={Trash2} title="Delete Account" description="Permanently delete your clinic account and all data" danger>
              <div>
                <Label htmlFor="delete-clinic-pw">Enter Password to Confirm</Label>
                <PasswordInput
                  id="delete-clinic-pw"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your password"
                  className="mt-2"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
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

      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent className="rounded-[30px] border border-white/70 bg-[#fbfaf7] p-5 sm:max-w-md">
          <DialogHeader className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#143b34] text-white">
              <QrCode className="h-6 w-6" />
            </div>
            <DialogTitle className="font-display text-2xl font-black text-[#17312d]">Clinic QR</DialogTitle>
            <DialogDescription className="text-sm">Patients scan this to join the queue.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center">
            {getClinicQrUrl() && (
              <div className="relative rounded-[28px] border border-[#eadfce] bg-white p-4 shadow-[0_22px_60px_-44px_rgba(19,55,50,0.75)]">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getClinicQrUrl())}`}
                  alt="Clinic QR Code"
                  className="h-48 w-48 rounded-2xl"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-black tracking-widest text-primary shadow-sm">KRAMA</span>
                </div>
              </div>
            )}
            <p className="mt-4 text-center text-sm font-bold text-[#17312d]">{dbProfile?.clinic_name}</p>
            <p className="mt-1 text-center text-xs text-muted-foreground">Place this near reception for walk-in patients.</p>

            <Button
              title="Download QR Code"
              variant="outline"
              onClick={downloadClinicQr}
              className="mt-4 w-full rounded-2xl py-6"
              disabled={!getClinicQrUrl()}
            >
              <Download className="mr-2 h-4 w-4" />
              Download QR
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={expandedImage !== null} onOpenChange={(open) => !open && setExpandedImage(null)}>
        <DialogContent className="max-w-4xl rounded-[28px] border border-white/70 bg-[#fbfaf7] p-0">
          {expandedImage && (
            <div className="overflow-hidden rounded-lg bg-black">
              <img
                src={`/api${expandedImage.url}`}
                alt={`Clinic ${expandedImage.index + 1}`}
                className="max-h-[82vh] w-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

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
        <DialogContent className="rounded-[28px] border border-white/70 bg-[#fbfaf7] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction === "phone" ? "Verify OTP for Phone Change" : 
               pendingAction === "password_forgot" ? "Verify OTP for Password Reset" : 
               pendingAction === "delete" ? "Verify OTP for Account Deletion" :
               pendingAction === "address" ? "Verify OTP for Address Change" :
               "Verify OTP"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "phone" 
                ? `Enter the OTP sent to ${dbProfile?.email || "your email"} to verify your new phone number.`
                : pendingAction === "password_forgot"
                ? `Enter the OTP sent to ${dbProfile?.email || "your email"} to reset your password.`
                : pendingAction === "delete"
                ? `Enter the OTP sent to ${dbProfile?.email || "your email"} to delete your account. This action cannot be undone.`
                : pendingAction === "address"
                ? `Enter the OTP sent to ${dbProfile?.email || "your email"} to verify your new address.`
                : `Enter the OTP sent to ${dbProfile?.email || "your email"} to continue.`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="clinic-profile-otp">OTP Code</Label>
            <Input
              id="clinic-profile-otp"
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
                Resend OTP
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
  <div className="space-y-2 rounded-[18px] bg-[#f6f1e8] p-4">
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
  <div className={`min-w-0 rounded-[18px] bg-[#f6f1e8] px-3 py-3 text-[#17312d] ${className}`}>
    <p className="text-[10px] font-black uppercase tracking-wide text-primary/75">{label}</p>
    <p className={`mt-2 truncate text-sm font-black leading-tight ${mono ? "font-mono" : ""}`}>{value}</p>
  </div>
);

const ProfileCard = ({
  icon: Icon,
  title,
  description,
  children,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) => (
  <div className={`rounded-[26px] border p-4 shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur ${danger ? "border-red-200 bg-red-50/70" : "border-white/70 bg-white/80"}`}>
    <div className="mb-4 flex items-center gap-3">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${danger ? "bg-red-100 text-red-600" : "bg-[#f6f1e8] text-primary"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-black leading-tight text-slate-950">{title}</h2>
        <p className="mt-0.5 text-sm leading-snug text-slate-500">{description}</p>
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

export default ClinicProfile;
