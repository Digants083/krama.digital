import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { AlertCircle, CalendarDays, Eye, MapPin, ReceiptText, Settings, User, Users } from "lucide-react";
import LocationPickerModal from "@/components/clinic/LocationPickerModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DashboardAction {
  to: string;
  label: string;
  Icon: typeof Settings;
}

interface ClinicProfile {
  clinic_id?: string;
  clinic_name?: string;
  name?: string;
  address?: string;
  full_formatted_address?: string;
  street_address?: string;
  road?: string;
  layout?: string;
  section?: string;
  city?: string;
  pincode?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  admin_pinned_latitude?: string | number | null;
  admin_pinned_longitude?: string | number | null;
  has_pinned_location?: boolean;
}

const CLINIC_FIRST_LOGIN_LOCATION_KEY = "clinic_first_login_location";

const loadFirstLoginLocation = (): ClinicProfile | null => {
  try {
    const stored = localStorage.getItem(CLINIC_FIRST_LOGIN_LOCATION_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored) as ClinicProfile & { first_login?: boolean };
    const suggestedLatitude = data.admin_pinned_latitude || (!data.has_pinned_location ? data.latitude : null);
    const suggestedLongitude = data.admin_pinned_longitude || (!data.has_pinned_location ? data.longitude : null);

    if (!data.first_login || !suggestedLatitude || !suggestedLongitude || data.has_pinned_location) {
      return null;
    }

    return {
      ...data,
      admin_pinned_latitude: suggestedLatitude,
      admin_pinned_longitude: suggestedLongitude,
      has_pinned_location: false,
    };
  } catch {
    return null;
  }
};

const ActionTile = ({ action }: { action: DashboardAction }) => (
  <Link to={action.to} className="block">
    <div className="flex min-h-[92px] flex-col justify-between rounded-[18px] bg-white/10 p-4 text-white transition duration-200 hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:min-h-[116px] sm:rounded-[22px] sm:p-5">
      <action.Icon className="h-6 w-6 stroke-[2.4] text-white sm:h-8 sm:w-8" />
      <h3 className="text-sm font-bold leading-tight tracking-[-0.01em] sm:text-lg">{action.label}</h3>
    </div>
  </Link>
);

const ClinicDashboardNew = () => {
  const [clinicName, setClinicName] = useState("Clinic");
  const [clinicProfile, setClinicProfile] = useState<ClinicProfile | null>(() => loadFirstLoginLocation());
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const clinicId = localStorage.getItem("clinic_id") || "";
  const pendingLatitude = clinicProfile?.admin_pinned_latitude || (!clinicProfile?.has_pinned_location ? clinicProfile?.latitude : null);
  const pendingLongitude = clinicProfile?.admin_pinned_longitude || (!clinicProfile?.has_pinned_location ? clinicProfile?.longitude : null);
  const hasConfirmedLocation = Boolean(clinicProfile?.latitude && clinicProfile?.longitude && clinicProfile?.has_pinned_location);
  const needsLocationConfirmation = Boolean(pendingLatitude && pendingLongitude && clinicProfile?.has_pinned_location === false);
  const clinicAddress = [
    clinicProfile?.street_address,
    clinicProfile?.road,
    clinicProfile?.layout,
    clinicProfile?.section,
    clinicProfile?.city,
    clinicProfile?.pincode,
  ].filter(Boolean).join(", ") || clinicProfile?.full_formatted_address || clinicProfile?.address || "";

  const fetchClinicData = useCallback(async () => {
    if (!clinicId) return;

    try {
      const response = await fetch(apiUrl(`/api/auth/clinic/data?clinic_id=${encodeURIComponent(clinicId)}`));
      if (!response.ok) return;
      const data: ClinicProfile = await response.json();
      setClinicProfile(data);
      setClinicName(data.clinic_name || data.name || clinicId);
      const suggestedLatitude = data.admin_pinned_latitude || (!data.has_pinned_location ? data.latitude : null);
      const suggestedLongitude = data.admin_pinned_longitude || (!data.has_pinned_location ? data.longitude : null);
      setShowLocationConfirm(Boolean(suggestedLatitude && suggestedLongitude && data.has_pinned_location === false));
    } catch {
      setClinicName(clinicId);
    }
  }, [clinicId]);

  useEffect(() => {
    void fetchClinicData();
  }, [fetchClinicData]);

  useEffect(() => {
    if (needsLocationConfirmation) {
      setShowLocationConfirm(true);
    }
  }, [needsLocationConfirmation]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const saveLocation = async (lat: string, lng: string, address?: string) => {
    if (!clinicId) return;
    try {
      const response = await fetch(apiUrl("/api/auth/clinic/update-location"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          latitude: lat,
          longitude: lng,
          address: address || clinicAddress,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ text: data.detail || "Failed to save location", type: "error" });
        return;
      }
      setClinicProfile((current) => ({
        ...(current || {}),
        latitude: data.latitude || lat,
        longitude: data.longitude || lng,
        admin_pinned_latitude: null,
        admin_pinned_longitude: null,
        has_pinned_location: true,
      }));
      localStorage.removeItem(CLINIC_FIRST_LOGIN_LOCATION_KEY);
      setShowLocationConfirm(false);
      setShowLocationModal(false);
      setMessage({ text: "Clinic location saved.", type: "success" });
    } catch {
      setMessage({ text: "Network error while saving location", type: "error" });
    }
  };

  const acceptAdminPin = async () => {
    if (!pendingLatitude || !pendingLongitude) return;
    await saveLocation(String(pendingLatitude), String(pendingLongitude), clinicAddress);
  };

  const actions: DashboardAction[] = [
    { to: "/clinic/manage-time", label: "Manage Time", Icon: Settings },
    { to: "/clinic/control-queue", label: "Control Queue", Icon: Users },
    { to: "/clinic/billing", label: "Billing", Icon: ReceiptText },
    { to: "/clinic/look", label: "Look Up Patients", Icon: Eye },
    { to: "/doctor-dashboard", label: "Doctor Dashboard", Icon: User },
    { to: "/clinic/reports", label: "Patient Reports", Icon: CalendarDays },
  ];

  return (
    <div className="min-h-screen bg-[#f5f3ee] px-4 py-6 md:py-12">
      {message && (
        <div className={`fixed right-4 top-4 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${message.type === "success" ? "bg-[#1a5c4a] text-white" : "bg-red-600 text-white"}`}>
          {message.text}
        </div>
      )}

      <main className="mx-auto max-w-5xl">
        <section className="rounded-[24px] bg-[#1d6758] px-5 py-6 text-white shadow-[0_38px_80px_-46px_rgba(18,64,54,0.85)] sm:rounded-[30px] sm:px-6 sm:py-8 md:px-9 md:py-10">
          <div className="mb-6 flex items-start justify-between gap-4 sm:mb-9">
            <div className="min-w-0">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-white/75 sm:mb-6 sm:text-sm sm:tracking-[0.32em]">Clinic Dashboard</p>
              <h1 className="truncate text-3xl font-extrabold leading-none tracking-[-0.03em] sm:text-4xl md:text-5xl">{clinicName}</h1>
              <p className="mt-3 text-sm font-semibold text-white sm:mt-4 sm:text-base">Keep queue control simple and visible.</p>
            </div>

            <Link to="/clinic/profile" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-14 sm:w-14" aria-label="Profile settings">
              <User className="h-5 w-5 sm:h-6 sm:w-6" />
            </Link>
          </div>

          {needsLocationConfirmation && (
            <div className="mb-5 rounded-2xl border border-white/20 bg-white/10 p-4">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-white" />
                <div>
                  <p className="text-sm font-bold text-white">Confirm admin-pinned location</p>
                  <p className="mt-1 text-sm text-white/78">
                    Admin marked your clinic pin. Confirm it, or adjust the pin to your exact entrance.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" onClick={() => setShowLocationConfirm(true)} className="rounded-full bg-white text-[#1d6758] hover:bg-white/90">
                  Review Pin
                </Button>
              </div>
            </div>
          )}

          {!hasConfirmedLocation && !needsLocationConfirmation && (
            <div className="mb-5 rounded-2xl border border-yellow-300/30 bg-yellow-300/15 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-100" />
                <div>
                  <p className="text-sm font-bold text-white">Clinic location is not pinned</p>
                  <p className="mt-1 text-sm text-white/78">Set the exact map pin so patients can reach the right place.</p>
                </div>
              </div>
              <Button type="button" onClick={() => setShowLocationModal(true)} className="mt-3 rounded-full bg-white text-[#1d6758] hover:bg-white/90">
                Set Location
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {actions.map((action) => (
              <ActionTile key={action.label} action={action} />
            ))}
          </div>
        </section>
      </main>

      <Dialog open={showLocationConfirm} onOpenChange={setShowLocationConfirm}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Is this your exact clinic location?</DialogTitle>
            <DialogDescription>
              This is the pin marked by admin. Confirm it if it is correct, or choose no and click the map to set the exact location.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-secondary/40 p-4 text-sm">
            <div className="font-medium text-foreground">Admin pinned coordinate</div>
            <div className="mt-1 text-muted-foreground">{pendingLatitude}, {pendingLongitude}</div>
            {!!clinicAddress && <div className="mt-2 text-muted-foreground">{clinicAddress}</div>}
          </div>

          {pendingLatitude && pendingLongitude && (
            <iframe
              title="Admin pinned clinic location"
              className="h-72 w-full rounded-lg border"
              loading="lazy"
              src={`https://maps.google.com/maps?q=${pendingLatitude},${pendingLongitude}&z=17&output=embed`}
            />
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowLocationConfirm(false);
                setShowLocationModal(true);
              }}
            >
              No, I will adjust
            </Button>
            <Button onClick={acceptAdminPin}>Yes, save this pin</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LocationPickerModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSave={saveLocation}
        initialLatitude={pendingLatitude || clinicProfile?.latitude}
        initialLongitude={pendingLongitude || clinicProfile?.longitude}
        defaultCenter={
          pendingLatitude && pendingLongitude
            ? { lat: Number(pendingLatitude), lng: Number(pendingLongitude) }
            : undefined
        }
        defaultZoom={pendingLatitude && pendingLongitude ? 17 : undefined}
        clinicAddress={clinicAddress}
        title="Set Exact Clinic Location"
        description="Click the map to place the pin on the exact clinic entrance, then save."
      />
    </div>
  );
};

export default ClinicDashboardNew;
