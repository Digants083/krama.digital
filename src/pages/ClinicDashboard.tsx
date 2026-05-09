import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueue } from "@/context/QueueContext";
import { Eye, Settings, User, Users, MapPin, AlertCircle, FileText } from "lucide-react";
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

const ClinicDashboard = () => {
  const [clinicProfile, setClinicProfile] = useState<any>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showLocationConfirm, setShowLocationConfirm] = useState(false);
  const { fetchQueueForClinic } = useQueue();

  const hasLocation = clinicProfile?.latitude && clinicProfile?.longitude;
  const needsLocationConfirmation = hasLocation && clinicProfile?.has_pinned_location === false;

  // Check if clinic is diagnostic or scanning center
  const isDiagnosticCenter = clinicProfile?.categories?.some(
    (cat: string) => ["diagnostic_center", "scanning_center", "diagnostic", "scanning", "lab", "x-ray", "mri", "ct_scan"].includes(cat)
  );

  const actions = [
    {
      to: "/clinic/manage-time",
      title: "Manage Time",
      icon: Settings,
    },
    {
      to: "/clinic/control-queue",
      title: "Control Queue",
      icon: Users,
    },
    {
      to: "/clinic/look",
      title: "Look Up Patients",
      icon: Eye,
    },
    ...(isDiagnosticCenter ? [{
      to: "/clinic/reports",
      title: "Reports",
      icon: FileText,
    }] : []),
  ];

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const getClinicId = () => {
    try {
      return localStorage.getItem("clinic_id");
    } catch (error) {
      setMessage({ text: "Error getting clinic_id", type: "error" });
      return null;
    }
  };

  useEffect(() => {
    const clinicId = getClinicId();
    if (!clinicId) {
      return;
    }

    void fetchQueueForClinic(clinicId);

    const fetchClinicData = async () => {
      try {
        const response = await fetch(`/api/auth/clinic/data?clinic_id=${clinicId}`);
        if (response.ok) {
          const data = await response.json();
          setClinicProfile(data);
          if (data.latitude && data.longitude && data.has_pinned_location === false) {
            setShowLocationConfirm(true);
          } else if (!data.latitude || !data.longitude) {
            setShowLocationModal(true);
          }
        }
      } catch (error) {
        setMessage({ text: "Error fetching clinic data", type: "error" });
      }
    };

    void fetchClinicData();
  }, [fetchQueueForClinic]);

  const handleSaveLocation = async (lat: string, lng: string, address: string) => {
    const clinicId = getClinicId();
    if (!clinicId) return;

    try {
      const response = await fetch("/api/auth/clinic/update-location", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          latitude: lat,
          longitude: lng,
          address: address || clinicProfile?.address,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setClinicProfile((prev: any) => ({
          ...prev,
          latitude: data.latitude,
          longitude: data.longitude,
          has_pinned_location: data.has_pinned_location,
        }));
        setShowLocationConfirm(false);
        setMessage({ text: "Location saved successfully!", type: "success" });
      } else {
        setMessage({ text: "Failed to save location", type: "error" });
      }
    } catch (error) {
      setMessage({ text: "Error saving location", type: "error" });
    }
  };

  const handleAcceptPinnedLocation = async () => {
    if (!clinicProfile?.latitude || !clinicProfile?.longitude) return;
    await handleSaveLocation(
      clinicProfile.latitude,
      clinicProfile.longitude,
      clinicProfile.address || ""
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {message && (
        <div className="fixed right-4 top-4 z-50 rounded-full bg-foreground px-4 py-2 text-sm text-white shadow-lg">
          {message.text}
        </div>
      )}

      <main className="section-container px-4 py-8 md:px-8 md:py-10">
        <section className="rounded-[32px] bg-primary px-6 py-8 text-primary-foreground shadow-[0_24px_70px_-36px_rgba(31,92,84,0.9)] md:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.22em] text-primary-foreground/70">Clinic Dashboard</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">
                {clinicProfile?.clinic_name || "Clinic"}
              </h1>
              <p className="mt-3 text-primary-foreground/78">
                Keep queue control simple and visible.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!hasLocation && (
                <Button
                  variant="outline"
                  onClick={() => setShowLocationModal(true)}
                  className="border-yellow-400 bg-yellow-400/20 text-yellow-100 hover:bg-yellow-400/30"
                >
                  <MapPin className="mr-2 h-4 w-4" />
                  Set Location
                </Button>
              )}
              <Link
                to="/clinic/profile"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
                aria-label="Clinic profile"
              >
                <User className="h-5 w-5" />
              </Link>
            </div>
          </div>

          {!hasLocation && (
            <div className="mt-6 flex items-center gap-2 rounded-lg bg-yellow-500/20 px-4 py-3">
              <AlertCircle className="h-5 w-5 text-yellow-300" />
              <p className="text-sm text-yellow-100">
                Please set your clinic location to help patients find you easily.
              </p>
            </div>
          )}

          {needsLocationConfirmation && (
            <div className="mt-6 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-3">
              <MapPin className="h-5 w-5 text-white" />
              <p className="text-sm text-white">
                Please confirm the admin-pinned clinic location before continuing.
              </p>
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-4">
            {actions.map((action) => (
              <Link
                key={action.title}
                to={action.to}
                className="rounded-[22px] bg-white/10 px-4 py-5 transition hover:bg-white/15"
              >
                <action.icon className="h-7 w-7 text-white" />
                <p className="mt-4 text-lg font-bold text-white">{action.title}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <LocationPickerModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSave={handleSaveLocation}
        initialLatitude={clinicProfile?.latitude}
        initialLongitude={clinicProfile?.longitude}
        clinicAddress={
          [
            clinicProfile?.street_address,
            clinicProfile?.road,
            clinicProfile?.layout,
            clinicProfile?.section,
            clinicProfile?.city,
            clinicProfile?.pincode
          ].filter(Boolean).join(", ")
        }
      />

      <Dialog open={showLocationConfirm} onOpenChange={setShowLocationConfirm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Clinic Location</DialogTitle>
            <DialogDescription>
              Admin pinned this coordinate for your clinic. Confirm it if correct, or adjust the pin.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border bg-secondary/40 p-4 text-sm">
            <div className="font-medium text-foreground">Pinned coordinate</div>
            <div className="mt-1 text-muted-foreground">
              {clinicProfile?.latitude}, {clinicProfile?.longitude}
            </div>
            {!!clinicProfile?.address && (
              <div className="mt-2 text-muted-foreground">{clinicProfile.address}</div>
            )}
          </div>

          {clinicProfile?.latitude && clinicProfile?.longitude && (
            <iframe
              title="Admin pinned clinic location"
              className="h-64 w-full rounded-lg border"
              loading="lazy"
              src={`https://maps.google.com/maps?q=${clinicProfile.latitude},${clinicProfile.longitude}&z=17&output=embed`}
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
              No, adjust pin
            </Button>
            <Button onClick={handleAcceptPinnedLocation}>
              Yes, location is correct
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClinicDashboard;
