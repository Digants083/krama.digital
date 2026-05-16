import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { CalendarDays, Eye, Settings, User, Users } from "lucide-react";

interface DashboardAction {
  to: string;
  label: string;
  Icon: typeof Settings;
}

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
  const clinicId = localStorage.getItem("clinic_id") || "";

  const fetchClinicName = useCallback(async () => {
    if (!clinicId) return;

    try {
      const response = await fetch(apiUrl(`/api/auth/clinic/data?clinic_id=${encodeURIComponent(clinicId)}`));
      if (!response.ok) return;
      const data = await response.json();
      setClinicName(data.clinic_name || data.name || clinicId);
    } catch {
      setClinicName(clinicId);
    }
  }, [clinicId]);

  useEffect(() => {
    void fetchClinicName();
  }, [fetchClinicName]);

  const actions: DashboardAction[] = [
    { to: "/clinic/manage-time", label: "Manage Time", Icon: Settings },
    { to: "/clinic/control-queue", label: "Control Queue", Icon: Users },
    { to: "/clinic/look", label: "Look Up Patients", Icon: Eye },
    { to: "/doctor-dashboard", label: "Doctor Dashboard", Icon: User },
    { to: "/clinic/reports", label: "Patient Reports", Icon: CalendarDays },
  ];

  return (
    <div className="min-h-screen bg-[#f5f3ee] px-4 py-6 md:py-12">
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

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {actions.map((action) => (
              <ActionTile key={action.label} action={action} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default ClinicDashboardNew;
