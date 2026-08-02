import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Check, Search } from "lucide-react";

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (lat: string, lng: string, address: string) => Promise<void>;
  clinicAddress?: string;
  initialLatitude?: string | number | null;
  initialLongitude?: string | number | null;
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
  title?: string;
  description?: string;
}

declare global {
  interface Window {
    google: typeof google;
    initMap: () => void;
  }
}

const MAP_ID = "clinic-location-picker";
export const INDIA_MAP_CENTER = { lat: 20.5937, lng: 78.9629 };

export const buildIndiaAddressQuery = (address: string): string => {
  const trimmedAddress = address.trim();
  if (!trimmedAddress) return "";
  return /\bindia\b/i.test(trimmedAddress) ? trimmedAddress : `${trimmedAddress}, India`;
};

export const parseMapCoordinates = (
  latitude?: string | number | null,
  longitude?: string | number | null,
): { lat: number; lng: number } | null => {
  const hasLatitude = latitude !== null && latitude !== undefined && String(latitude).trim() !== "";
  const hasLongitude = longitude !== null && longitude !== undefined && String(longitude).trim() !== "";
  if (!hasLatitude || !hasLongitude) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
};

export default function LocationPickerModal({
  isOpen,
  onClose,
  onSave,
  clinicAddress = "",
  initialLatitude,
  initialLongitude,
  defaultCenter = INDIA_MAP_CENTER,
  defaultZoom = 5,
  title = "Pin Your Clinic Location",
  description = "Pan/zoom the map to your clinic area, then click to drop the pin on the exact location.",
}: LocationPickerModalProps) {
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [savedAddress, setSavedAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [saveError, setSaveError] = useState("");
  const [addressLookupMessage, setAddressLookupMessage] = useState("");
  
  const mapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const initializedRef = useRef(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
      mapInstanceRef.current = null;
      markerRef.current = null;
      setSelectedLocation(null);
      setSavedAddress("");
      setSearchQuery("");
      setSaveError("");
      setAddressLookupMessage("");
      return;
    }
    setSavedAddress("");
    setSearchQuery(clinicAddress);
    setSaveError("");
    setAddressLookupMessage("");
  }, [isOpen, clinicAddress]);

  useEffect(() => {
    if (!isOpen) return;

    const loadGoogleMaps = () => {
      if (!apiKey) {
        setMapError(true);
        return;
      }
      if (window.google) {
        setMapLoaded(true);
        return;
      }

      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&region=IN&language=en&callback=initMap`;
      script.async = true;
      script.defer = true;
      
      window.initMap = () => {
        setMapLoaded(true);
      };

      script.onerror = () => {
        setMapError(true);
      };

      document.head.appendChild(script);
    };

    loadGoogleMaps();
  }, [isOpen, apiKey]);

  useEffect(() => {
    if (!isOpen || !mapLoaded || !mapRef.current || !window.google || initializedRef.current) return;
    initializedRef.current = true;

    const initMap = async () => {
      let center = defaultCenter;
      const initialLocation = parseMapCoordinates(initialLatitude, initialLongitude);
      const hasInitialLocation = initialLocation !== null;
      if (initialLocation) {
        center = initialLocation;
        setSelectedLocation(center);
        setSavedAddress(`${initialLocation.lat.toFixed(6)}, ${initialLocation.lng.toFixed(6)}`);
      }

      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center,
        zoom: hasInitialLocation ? 16 : defaultZoom,
        mapId: MAP_ID,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: window.google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          mapTypeIds: [
            window.google.maps.MapTypeId.ROADMAP,
            window.google.maps.MapTypeId.SATELLITE,
          ],
        },
      });

      const setMarkerLocation = (
        location: google.maps.LatLng | google.maps.LatLngLiteral,
        addressLabel?: string
      ) => {
        const lat =
          typeof (location as google.maps.LatLng).lat === "function"
            ? (location as google.maps.LatLng).lat()
            : (location as google.maps.LatLngLiteral).lat;
        const lng =
          typeof (location as google.maps.LatLng).lng === "function"
            ? (location as google.maps.LatLng).lng()
            : (location as google.maps.LatLngLiteral).lng;
        const markerPosition = { lat, lng };

        setSelectedLocation(markerPosition);

        if (markerRef.current) {
          markerRef.current.setPosition(markerPosition);
        } else {
          markerRef.current = new window.google.maps.Marker({
            position: markerPosition,
            map: mapInstanceRef.current,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#00555A",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });
        }

        mapInstanceRef.current?.panTo(markerPosition);
        setSavedAddress(addressLabel || `${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      };

      if (hasInitialLocation) {
        markerRef.current = new window.google.maps.Marker({
          position: center,
          map: mapInstanceRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#00555A",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
      }

      if (searchInputRef.current && window.google.maps.places) {
        const autocomplete = new window.google.maps.places.Autocomplete(searchInputRef.current, {
          componentRestrictions: { country: "in" },
          fields: ["formatted_address", "geometry", "name"],
        });

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const location = place?.geometry?.location;
          if (!place || !location) {
            return;
          }

          setMarkerLocation(
            location,
            place.formatted_address || place.name || `${location.lat().toFixed(6)}, ${location.lng().toFixed(6)}`
          );
          mapInstanceRef.current?.setZoom(17);
        });
      }

      if (!hasInitialLocation && clinicAddress.trim()) {
        const addressQuery = buildIndiaAddressQuery(clinicAddress);
        setAddressLookupMessage("Finding the clinic address on the map...");

        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode(
          {
            address: addressQuery,
            componentRestrictions: { country: "IN" },
            region: "IN",
          },
          (results, status) => {
            const result = results?.[0];
            const location = result?.geometry?.location;
            if (status === window.google.maps.GeocoderStatus.OK && location) {
              const formattedAddress = result.formatted_address || clinicAddress;
              setMarkerLocation(location, formattedAddress);
              setSearchQuery(formattedAddress);
              mapInstanceRef.current?.setZoom(17);
              setAddressLookupMessage("Suggested pin placed from the registered address. Please verify it before saving.");
              return;
            }

            setAddressLookupMessage("The address could not be located automatically. Search the area or click the map to place the pin.");
          },
        );
      }

      const clickListener = mapInstanceRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          setMarkerLocation(e.latLng);
        }
      });
    };

    initMap();

    return () => {
      initializedRef.current = false;
    };
  }, [isOpen, mapLoaded, clinicAddress, initialLatitude, initialLongitude, defaultCenter, defaultZoom]);

  const handleSave = async () => {
    if (!selectedLocation) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(
        selectedLocation.lat.toString(),
        selectedLocation.lng.toString(),
        savedAddress
      );
      onClose();
    } catch (error) {
      console.error("Error saving location:", error);
      setSaveError(error instanceof Error ? error.message : "Could not save the clinic location. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  if (!mapLoaded && !mapError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="flex h-64 w-full max-w-lg items-center justify-center rounded-xl bg-white p-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading map...</span>
        </div>
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-lg rounded-xl bg-white p-6">
          <p className="text-red-500">Error loading Google Maps. Please check your API key.</p>
          <Button onClick={onClose} className="mt-4">Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            &times;
          </Button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          {description}
        </p>

        {!!clinicAddress && (
          <div className="mb-4 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Address sent for map lookup</div>
            <div className="mt-1 break-words">{clinicAddress}</div>
          </div>
        )}

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search clinic name, address, landmark, or area"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full pl-9"
          />
        </div>

        <div ref={mapRef} className="mb-4 h-[400px] w-full overflow-hidden rounded-lg border" />

        {addressLookupMessage && (
          <p className="mb-4 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            {addressLookupMessage}
          </p>
        )}

        {selectedLocation && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-secondary p-3">
            <MapPin className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">Selected Location</p>
              <p className="text-sm text-muted-foreground">
                {savedAddress || `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`}
              </p>
            </div>
          </div>
        )}

        {saveError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedLocation || saving}
            className="bg-primary text-white hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save Location
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
