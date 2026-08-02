import { MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LocationAccessCardProps {
  onUseGPS: () => void;
  loading?: boolean;
}

const LocationAccessCard = ({ onUseGPS, loading }: LocationAccessCardProps) => (
  <div className="mx-auto max-w-xl overflow-hidden rounded-[32px] border border-white/70 bg-white/85 p-5 text-center shadow-[0_22px_70px_-44px_rgba(19,55,50,0.75)] backdrop-blur sm:p-6">
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f6f1e8] text-primary">
      <Navigation className="h-7 w-7 text-primary" />
    </div>
    <h3 className="font-display text-2xl font-black leading-tight text-[#17312d]">
      Allow location access to find nearby clinics
    </h3>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
      We use your location only to show nearby clinics. After you tap the button, your browser will ask for permission.
    </p>

    {loading && (
      <div className="motion-rise mt-5 overflow-hidden rounded-[24px] border border-[#eadfce] bg-[#fbfaf7] p-3 text-left shadow-[0_18px_54px_-42px_rgba(19,55,50,0.65)]">
        <img
          src="/krama-location-permission-guide.png"
          alt="Browser location permission guide showing where to click Allow"
          className="w-full rounded-[18px]"
        />
        <div className="mt-3 rounded-2xl bg-[#143b34] px-4 py-3 text-white">
          <p className="text-sm font-black">Look near the browser address bar</p>
          <p className="mt-1 text-xs leading-5 text-white/70">
            Click <span className="font-black text-[#f6d8c4]">Allow</span> on the location permission popup.
          </p>
        </div>
      </div>
    )}

    <div className="mt-6">
      <Button onClick={onUseGPS} disabled={loading} className="w-full rounded-2xl py-6 font-black sm:w-auto">
        {loading ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
            Waiting for permission...
          </>
        ) : (
          <>
            <MapPin className="mr-1 h-4 w-4" />
            Use Current Location
          </>
        )}
      </Button>
    </div>
  </div>
);

export default LocationAccessCard;
