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
    <div className="flex min-h-[116px] flex-col justify-between rounded-[22px] bg-white/10 p-5 text-white transition duration-200 hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
      <action.Icon className="h-8 w-8 stroke-[2.4] text-white" />
      <h3 className="text-lg font-bold leading-tight tracking-[-0.01em]">{action.label}</h3>
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
    <div className="min-h-screen bg-[#f8f6f2] px-4 py-8 md:py-12">
      <main className="mx-auto max-w-5xl">
        <section className="rounded-[30px] bg-[#1d6758] px-6 py-8 text-white shadow-[0_38px_80px_-46px_rgba(18,64,54,0.85)] md:px-9 md:py-10">
          <div className="mb-9 flex items-start justify-between gap-4">
            <div>
              <p className="mb-6 text-sm font-medium uppercase tracking-[0.32em] text-white/75">Clinic Dashboard</p>
              <h1 className="text-4xl font-extrabold leading-none tracking-[-0.03em] md:text-5xl">{clinicName}</h1>
              <p className="mt-4 text-base font-semibold text-white">Keep queue control simple and visible.</p>
            </div>

            <Link to="/clinic/profile" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="Profile settings">
              <User className="h-6 w-6" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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