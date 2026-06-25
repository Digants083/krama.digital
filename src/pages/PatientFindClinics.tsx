import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import SearchBar from "@/components/shared/SearchBar";
import ClinicCard from "@/components/shared/ClinicCard";
import LocationAccessCard from "@/components/shared/LocationAccessCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, MapPin } from "lucide-react";
import type { Clinic } from "@/data/mockData";

type ClinicApiResponse = {
  clinic_id: string;
  clinic_name: string;
  address: string;
  street_address?: string | null;
  road?: string | null;
  layout?: string | null;
  section?: string | null;
  city: string;
  pincode?: string | null;
  phone: string;
  doctors?: { doctor_id?: string; name: string; specialization?: string }[];
  specializations?: string[];
  is_active?: boolean;
  available?: boolean;
  latitude?: string | null;
  longitude?: string | null;
};

type ReviewApiResponse = {
  average_rating?: number;
  total?: number;
};

type ClinicWithDistance = Clinic & {
  distanceValue: number;
  isActive: boolean;
};

const SEARCH_RADIUS_KM = 5;

const medicalCategories: Record<
  string,
  { name: string; description: string; icon: string }
> = {
  all: {
    name: "All Categories",
    description: "Show all clinics and specializations",
    icon: "hospital",
  },
  general: {
    name: "General",
    description: "Fever, cold, and general health issues",
    icon: "general",
  },
  skin: {
    name: "Skin",
    description: "Skin problems, allergies, treatments",
    icon: "skin",
  },
  dental: {
    name: "Dental",
    description: "Teeth cleaning, filling, extraction",
    icon: "dental",
  },
  bone: {
    name: "Bone & Joint",
    description: "Bone fractures, joint pain treatment",
    icon: "bone",
  },
  eye: {
    name: "Eye",
    description: "Vision check, glasses, eye problems",
    icon: "eye",
  },
  ent: {
    name: "ENT",
    description: "Ear nose throat problems treatment",
    icon: "ent",
  },
  heart: {
    name: "Cardiology",
    description: "Heart-related issues",
    icon: "heart",
  },
  neuro: {
    name: "Neurology",
    description: "Brain, nerves, spine",
    icon: "neuro",
  },
  child: {
    name: "Pediatric",
    description: "Child care, vaccination",
    icon: "child",
  },
  women: {
    name: "Gynecology",
    description: "Women's health",
    icon: "women",
  },
  mental: {
    name: "Mental Health",
    description: "Psychiatry, counseling",
    icon: "mental",
  },
  physio: {
    name: "Physiotherapy",
    description: "Physical therapy, rehab",
    icon: "physio",
  },
  vet: {
    name: "Pet Hospital",
    description: "Pet treatment and grooming services",
    icon: "vet",
  },
  scanning: {
    name: "Scanning Center",
    description: "X-ray, MRI, CT scan services",
    icon: "scan",
  },
  lab: {
    name: "Diagnostic Lab",
    description: "Blood tests, diagnostics",
    icon: "lab",
  },
  ayurveda: {
    name: "Ayurveda",
    description: "Ayurvedic treatment",
    icon: "leaf",
  },
  homeo: {
    name: "Homeopathy",
    description: "Homeopathic treatment",
    icon: "pill",
  },
  other: {
    name: "Other",
    description: "Other specializations",
    icon: "other",
  },
};

const categoryEmoji: Record<string, string> = {
  all: "🏥",
  general: "🩺",
  skin: "✨",
  dental: "🦷",
  bone: "🦴",
  eye: "👁️",
  ent: "👂",
  heart: "❤️",
  neuro: "🧠",
  child: "👶",
  women: "🌸",
  mental: "🧘",
  physio: "🏃",
  vet: "🐾",
  scanning: "🔬",
  lab: "🧪",
  ayurveda: "🌿",
  homeo: "💊",
  other: "➕",
};

const categoryLabel = (key: string) => `${categoryEmoji[key] || "🏥"} ${medicalCategories[key]?.name || key}`;

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineDistanceKm = (
  userLat: number,
  userLon: number,
  clinicLat: number,
  clinicLon: number
) => {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(clinicLat - userLat);
  const deltaLon = toRadians(clinicLon - userLon);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(userLat)) *
      Math.cos(toRadians(clinicLat)) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const PatientFindClinics = () => {
  const [locationGranted, setLocationGranted] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [clinics, setClinics] = useState<ClinicWithDistance[]>([]);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!locationGranted || !userCoords) {
      return;
    }

    const fetchClinics = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/auth/clinics/list");
        if (!response.ok) {
          setMessage({ text: "Failed to fetch clinics", type: "error" });
          return;
        }

        const data = await response.json();

        const clinicCards = await Promise.all(
          (data.clinics as ClinicApiResponse[]).map(async (clinic) => {
            try {
              const reviewsResponse = await fetch(
                `/api/auth/reviews/clinic?clinic_id=${clinic.clinic_id}`
              );

              const reviewData: ReviewApiResponse = reviewsResponse.ok
                ? await reviewsResponse.json()
                : {};

              const clinicLatitude = clinic.latitude ? Number(clinic.latitude) : NaN;
              const clinicLongitude = clinic.longitude ? Number(clinic.longitude) : NaN;
              const hasValidCoords =
                Number.isFinite(clinicLatitude) && Number.isFinite(clinicLongitude);
              const distanceValue = hasValidCoords
                ? haversineDistanceKm(
                    userCoords.latitude,
                    userCoords.longitude,
                    clinicLatitude,
                    clinicLongitude
                  )
                : Number.POSITIVE_INFINITY;

              const fullAddress = [
                clinic.street_address,
                clinic.road,
                clinic.layout,
                clinic.section,
                clinic.city,
                clinic.pincode,
              ].filter(Boolean).join(", ") || clinic.address || "";

              return {
                id: clinic.clinic_id,
                name: clinic.clinic_name,
                address: fullAddress,
                city: clinic.city || "",
                distance: Number.isFinite(distanceValue)
                  ? `${distanceValue.toFixed(1)} km`
                  : "Distance unavailable",
                distanceValue,
                rating: reviewData.average_rating || 0,
                reviewCount: reviewData.total || 0,
                phone: clinic.phone,
                doctors: clinic.doctors?.length ? clinic.doctors : [{ name: "Available Doctor" }],
                specializations: clinic.specializations?.length ? clinic.specializations : ["general"],
                isActive: Boolean(clinic.is_active && clinic.available !== false),
              };
            } catch (error) {
              console.error("Error building clinic card:", clinic.clinic_id, error);
              return null;
            }
          })
        );

        setClinics(
          clinicCards
            .filter((clinic): clinic is ClinicWithDistance => clinic !== null)
            .sort((a, b) => {
              if (a.isActive !== b.isActive) {
                return a.isActive ? -1 : 1;
              }
              if (a.distanceValue !== b.distanceValue) {
                return a.distanceValue - b.distanceValue;
              }
              return a.name.localeCompare(b.name);
            })
        );
      } catch (error) {
        setMessage({ text: "Error fetching clinics", type: "error" });
      } finally {
        setLoading(false);
      }
    };

    void fetchClinics();
  }, [locationGranted, userCoords]);

  const handleGPS = () => {
    setLocationLoading(true);
    setMessage({ text: "Your browser may ask for location permission. Tap Allow to continue.", type: "success" });

    if (!navigator.geolocation) {
      setLocationLoading(false);
      setMessage({ text: "Geolocation is not supported on this device.", type: "error" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserCoords({ latitude, longitude });
        setLocationGranted(true);
        setLocationLoading(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
        setLocationLoading(false);
        const denied = error.code === error.PERMISSION_DENIED;
        setMessage({
          text: denied
            ? "Location is blocked. Enable location permission in your browser settings and try again."
            : "Could not get location. Please try again.",
          type: "error",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

  const searchText = search.trim().toLowerCase();
  const isSearching = searchText.length > 0;

  const matchesSearch = (clinic: ClinicWithDistance) => {
    if (!isSearching) {
      return true;
    }

    return (
      clinic.name.toLowerCase().includes(searchText) ||
      clinic.address.toLowerCase().includes(searchText) ||
      clinic.city.toLowerCase().includes(searchText) ||
      clinic.doctors.some((doctor) => doctor.name.toLowerCase().includes(searchText)) ||
      clinic.specializations.some((specialization) =>
        specialization.toLowerCase().includes(searchText)
      )
    );
  };

  const matchesCategory = (clinic: ClinicWithDistance) =>
    selectedCategory === "all" ||
    clinic.specializations.some(
      (specialization) => specialization.toLowerCase() === selectedCategory.toLowerCase()
    );

  const displayedClinics = clinics.filter((clinic) => {
    if (isSearching) {
      return matchesSearch(clinic);
    }

    return clinic.distanceValue <= SEARCH_RADIUS_KM && matchesCategory(clinic);
  });

  const availableClinics = displayedClinics.filter((clinic) => clinic.isActive);
  const unavailableClinics = displayedClinics.filter((clinic) => !clinic.isActive);
  const emptyMessage = isSearching
    ? "No clinics matched your search."
    : `No clinics found within ${SEARCH_RADIUS_KM} km for the selected category.`;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link
            to="/patient"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground -ml-2"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm font-medium">Dashboard</span>
          </Link>
          <span className="font-semibold text-foreground">Find clinics</span>
        </div>
      </header>

      {message && (
        <div
          className={`fixed top-16 right-4 z-50 rounded-lg px-6 py-3 text-white shadow-lg ${
            message.type === "success" ? "bg-green-500" : "bg-red-500"
          }`}
        >
          {message.text}
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-foreground">Find Clinics Near You</h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground sm:text-base">
                Nearby clinics first. Search works anywhere.
              </p>
            </div>
            {locationGranted && (
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" title="Location enabled" aria-label="Location enabled">
                <MapPin className="h-4 w-4" />
              </span>
            )}
          </div>
        </section>

        {!locationGranted ? (
          <div className="mt-10">
            <LocationAccessCard onUseGPS={handleGPS} loading={locationLoading} />
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-3 sm:mt-6">
              <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
                <div className="flex-1">
                  <SearchBar value={search} onChange={setSearch} />
                </div>
                <div>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="h-11 w-full rounded-2xl border-border bg-card px-4 font-semibold shadow-sm">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(medicalCategories).map(([key, category]) => (
                        <SelectItem key={key} value={key}>
                          {categoryEmoji[key] || "🏥"} {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <section className="mt-6 space-y-4" aria-label="Clinic list">
              {loading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="rounded-xl border border-border p-5">
                    <Skeleton className="mb-3 h-5 w-48" />
                    <Skeleton className="mb-2 h-4 w-64" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))
              ) : displayedClinics.length > 0 ? (
                <>
                  {availableClinics.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        {isSearching ? "Available Matches" : "Available Nearby"}
                      </h2>
                      {availableClinics.map((clinic) => (
                        <ClinicCard key={clinic.id} clinic={clinic} />
                      ))}
                    </div>
                  )}

                  {unavailableClinics.length > 0 && (
                    <div className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        {isSearching ? "Not Available Matches" : "Not Available Right Now"}
                      </h2>
                      {unavailableClinics.map((clinic) => (
                        <ClinicCard key={clinic.id} clinic={clinic} />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="py-12 text-center text-muted-foreground">
                  {emptyMessage}
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default PatientFindClinics;
