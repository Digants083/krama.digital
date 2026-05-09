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
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-foreground">
            {clinic.name}
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{clinic.address}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clinic.specializations.map((s) => (
              <span
                key={s}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
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
          <span className="mt-1 text-xs font-medium text-accent">
            {clinic.distance}
          </span>
          <span
            className={`mt-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isActive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {isActive ? "Available now" : "Not available now"}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {clinic.doctors.length} doctor{clinic.doctors.length > 1 ? "s" : ""} listed
        </p>
        <Button
          size="sm"
          onClick={() => navigate(`/clinic-details/${clinic.id}`)}
        >
          {isActive ? "Book Appointment" : "View Details"}
        </Button>
      </div>
    </div>
  );
};

export default ClinicCard;
