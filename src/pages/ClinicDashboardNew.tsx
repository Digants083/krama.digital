import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl, clinicAuthHeaders } from "@/lib/api";
import { AlertCircle, CalendarDays, ChevronRight, Eye, MapPin, ReceiptText, Settings, User, Users } from "lucide-react";
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
  first_login?: boolean;
}

const CLINIC_FIRST_LOGIN_LOCATION_KEY = "clinic_first_login_location";

const loadFirstLoginLocation = (): ClinicProfile | null => {
  try {
    const stored = localStorage.getItem(CLINIC_FIRST_LOGIN_LOCATION_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored) as ClinicProfile & { first_login?: boolean };
    const suggestedLatitude = data.admin_pinned_latitude || (!data.has_pinned_location ? data.latitude : null);
    const suggestedLongitude = data.admin_pinned_longitude || (!data.has_pinned_location ? data.longitude : null);

    if (!data.first_login || data.has_pinned_location) {
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
  <Link to={action.to} className="group relative min-h-[152px] rounded-[26px] border border-white/70 bg-white/80 p-4 text-left shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur transition active:scale-[0.98] hover:-translate-y-0.5 hover:bg-white">
    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
      <action.Icon className="h-5 w-5 stroke-[2.4]" />
    </span>
    <span className="mt-4 block text-base font-black leading-tight text-slate-950">{action.label}</span>
    <span className="mt-1 block text-sm leading-5 text-slate-500">Open clinic tool</span>
    <ChevronRight className="absolute right-3 top-3 h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary" />
  </Link>
);

const ClinicDashboardNew = () => {
  const [clinicName, setClinicName] = useState("Clinic");
  const [clinicProfile, setClinicProfile] = useState<ClinicProfile | null>(() => loadFirstLoginLocation());
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [confirmingLocation, setConfirmingLocation] = useState(false);
  const [firstLoginLocationPending, setFirstLoginLocationPending] = useState(() => Boolean(loadFirstLoginLocation()));
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
      const response = await fetch(
        apiUrl(`/api/auth/clinic/data?clinic_id=${encodeURIComponent(clinicId)}`),
        { headers: clinicAuthHeaders() },
      );
      if (!response.ok) return;
      const data: ClinicProfile = await response.json();
      const firstLoginData = loadFirstLoginLocation();
      setClinicProfile({ ...(firstLoginData || {}), ...data });
      setClinicName(data.clinic_name || data.name || clinicId);
      const suggestedLatitude = data.admin_pinned_latitude || (!data.has_pinned_location ? data.latitude : null);
      const suggestedLongitude = data.admin_pinned_longitude || (!data.has_pinned_location ? data.longitude : null);
      const shouldConfirmSuggestedPin = Boolean(suggestedLatitude && suggestedLongitude && data.has_pinned_location === false);
      setShowLocationConfirm(shouldConfirmSuggestedPin);
      if (!shouldConfirmSuggestedPin && firstLoginData?.first_login && !data.has_pinned_location) {
        setShowLocationModal(true);
      }
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
        headers: clinicAuthHeaders(true),
        body: JSON.stringify({
          clinic_id: clinicId,
          latitude: lat,
          longitude: lng,
          address: address || clinicAddress,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = data.detail || "Failed to save location";
        throw new Error(detail);
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
      setFirstLoginLocationPending(false);
      setShowLocationConfirm(false);
      setShowLocationModal(false);
      setMessage({ text: "Clinic location saved.", type: "success" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Could not save the clinic location. Check the connection and try again.";
      setMessage({ text: detail, type: "error" });
      throw new Error(detail);
    }
  };

  const acceptAdminPin = async () => {
    if (!pendingLatitude || !pendingLongitude) return;
    setConfirmingLocation(true);
    try {
      await saveLocation(String(pendingLatitude), String(pendingLongitude), clinicAddress);
    } catch {
      // The dialog remains open and saveLocation displays the error.
    } finally {
      setConfirmingLocation(false);
    }
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
    <div className="min-h-screen bg-transparent">
      {message && (
        <div className={`fixed right-4 top-4 z-50 rounded-full px-4 py-2 text-sm shadow-lg ${message.type === "success" ? "bg-[#1a5c4a] text-white" : "bg-red-600 text-white"}`}>
          {message.text}
        </div>
      )}

      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <header className="motion-rise flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Clinic</p>
            <h1 className="mt-1 truncate font-display text-3xl font-bold text-[#17312d]">{clinicName}</h1>
          </div>
          <Link to="/clinic/profile" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-primary shadow-[0_16px_38px_-28px_rgba(19,55,50,0.7)]" aria-label="Profile settings">
            <User className="h-5 w-5" />
          </Link>
        </header>

        <section className="motion-rise-delayed motion-shimmer overflow-hidden rounded-[30px] bg-[#143b34] p-4 text-white shadow-[0_26px_70px_-42px_rgba(31,92,84,0.95)]">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">Clinic Dashboard</p>
              <h2 className="mt-2 truncate text-lg font-bold">Queue control center</h2>
              <p className="mt-1 text-sm text-white/70">Keep queue control simple and visible.</p>
            </div>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white/80">Live</span>
          </div>

          {needsLocationConfirmation && (
            <div className="mb-4 rounded-[22px] border border-white/20 bg-white/10 p-4">
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
            <div className="mb-4 rounded-[22px] border border-yellow-300/30 bg-yellow-300/15 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-100" />
                <div>
                  <p className="text-sm font-bold text-white">{firstLoginLocationPending ? "Complete your clinic location" : "Clinic location is not pinned"}</p>
                  <p className="mt-1 text-sm text-white/78">The map opens over India. Search your area and pin the exact clinic entrance.</p>
                </div>
              </div>
              <Button type="button" onClick={() => setShowLocationModal(true)} className="mt-3 rounded-full bg-white text-[#1d6758] hover:bg-white/90">
                Pin Clinic Location
              </Button>
            </div>
          )}

        </section>

        <section className="motion-rise-delayed grid grid-cols-2 gap-3">
            {actions.map((action) => (
              <ActionTile key={action.label} action={action} />
            ))}
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

          <DialogFooter className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              disabled={confirmingLocation}
              onClick={() => {
                setShowLocationConfirm(false);
                setShowLocationModal(true);
              }}
              className="w-full"
            >
              Choose a different location
            </Button>
            <Button onClick={acceptAdminPin} disabled={confirmingLocation} className="w-full">
              {confirmingLocation ? "Saving location..." : "Confirm this location"}
            </Button>
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
