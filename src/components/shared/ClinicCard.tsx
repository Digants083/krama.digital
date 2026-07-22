import { MapPin, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Clinic } from "@/data/mockData";
import { useNavigate } from "react-router-dom";

type ClinicCardClinic = Clinic & {
  isActive?: boolean;
};

interface ClinicCardProps {
  clinic: ClinicCardClinic;
}

const ClinicCard = ({ clinic }: ClinicCardProps) => {
  const navigate = useNavigate();
  const isActive = clinic.isActive !== false;

  return (
    <div className="rounded-[28px] border border-white/70 bg-white/85 p-4 shadow-[0_18px_54px_-42px_rgba(19,55,50,0.75)] backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-black text-[#17312d]">
            {clinic.name}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">{clinic.address}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clinic.specializations.map((s) => (
              <span
                key={s}
                className="rounded-full bg-[#f6f1e8] px-2.5 py-1 text-xs font-bold text-primary"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-semibold text-foreground">
              {clinic.rating}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {clinic.reviewCount} reviews
          </span>
          <span className="mt-1 rounded-full bg-[#f6d8c4]/70 px-2.5 py-1 text-xs font-black text-[#17312d]">
            {clinic.distance}
          </span>
          <span
            className={`mt-1 rounded-full px-2.5 py-1 text-xs font-bold ${
              isActive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {isActive ? "Available now" : "Not available now"}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eadfce] pt-4">
        <p className="text-sm text-muted-foreground">
          {clinic.doctors.length} doctor{clinic.doctors.length > 1 ? "s" : ""} listed
        </p>
        <Button
          size="sm"
          onClick={() => navigate(`/clinic-details/${clinic.id}`)}
          className="rounded-full px-4 font-black"
          variant={isActive ? "default" : "outline"}
        >
          {isActive ? "Book Appointment" : "View Details"}
        </Button>
      </div>
    </div>
  );
};

export default ClinicCard;
