import { FormEvent, useState } from "react";
import { ArrowLeft, Building2, Database, Loader2, LockKeyhole, LogOut, RefreshCw, Search, Stethoscope, Users } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

type DataSection = "clinics" | "patients" | "visits";

interface AdminDataViewProps {
  adminToken: string;
  onBack: () => void;
  onLogout: () => void;
}

interface PageResult {
  total: number;
  items: Array<Record<string, any>>;
}

const PAGE_SIZE = 50;

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);

export default function AdminDataView({ adminToken, onBack, onLogout }: AdminDataViewProps) {
  const [password, setPassword] = useState("");
  const [dataToken, setDataToken] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<DataSection>("clinics");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PageResult>({ total: 0, items: [] });

  const headers = (token?: string) => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken}`,
    ...(token ? { "X-Admin-Data-Token": token } : {}),
  });

  const fetchSection = async (
    nextSection: DataSection,
    token: string,
    nextPage = 0,
    query = search,
  ) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextPage * PAGE_SIZE),
      });
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(apiUrl(`/api/admin/data/${nextSection}?${params}`), {
        headers: headers(token),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          setDataToken("");
          setPassword("");
        }
        throw new Error(body.detail || "Could not load protected data");
      }
      setSection(nextSection);
      setPage(nextPage);
      setResult({ total: body.total || 0, items: body.items || [] });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load protected data");
    } finally {
      setLoading(false);
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setUnlocking(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/admin/data/unlock"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not unlock the data area");
      setPassword("");
      setDataToken(body.data_token);
      await fetchSection("clinics", body.data_token, 0, "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not unlock the data area");
    } finally {
      setUnlocking(false);
    }
  };

  const changeSection = (nextSection: DataSection) => {
    setSearch("");
    void fetchSection(nextSection, dataToken, 0, "");
  };

  const searchData = (event: FormEvent) => {
    event.preventDefault();
    void fetchSection(section, dataToken, 0, search);
  };

  if (!dataToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <header className="border-b bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
            <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={onLogout} className="gap-2">
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </header>
        <main className="mx-auto flex max-w-7xl justify-center px-4 py-16">
          <Card className="w-full max-w-md border-2 shadow-xl">
            <CardContent className="p-8">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <LockKeyhole className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Protected Data</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Enter the data-access password. Clinic and patient records are not fetched until access is verified.
              </p>
              <form onSubmit={unlock} className="mt-6 space-y-4">
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Data-access password"
                  autoComplete="current-password"
                  autoFocus
                />
                {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <Button type="submit" className="w-full" disabled={!password || unlocking}>
                  {unlocking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                  {unlocking ? "Verifying..." : "Unlock Data"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Platform Data</h1>
              <p className="text-xs text-slate-500">Protected, on-demand database view</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchSection(section, dataToken, page, search)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" /> Logout</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([
            ["clinics", "Clinic Information", Building2, "Registration, contact, address and doctors"],
            ["patients", "Patient Information", Users, "Patient profile and visit totals"],
            ["visits", "Clinic Visit History", Stethoscope, "Patients visited, grouped/searchable by clinic"],
          ] as const).map(([key, label, Icon, description]) => (
            <button
              key={key}
              type="button"
              onClick={() => changeSection(key)}
              className={`rounded-2xl border p-5 text-left transition ${section === key ? "border-primary bg-primary text-white shadow-lg" : "border-slate-200 bg-white hover:border-primary/50"}`}
            >
              <Icon className="mb-3 h-6 w-6" />
              <div className="font-semibold">{label}</div>
              <div className={`mt-1 text-xs ${section === key ? "text-white/75" : "text-slate-500"}`}>{description}</div>
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" /><h2 className="font-semibold">{result.total} records</h2></div>
                <p className="mt-1 text-xs text-slate-500">Only this section and page are fetched.</p>
              </div>
              <form onSubmit={searchData} className="flex w-full gap-2 sm:max-w-lg">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={section === "visits" ? "Search clinic or patient" : `Search ${section}`} />
                <Button type="submit" variant="outline" disabled={loading}><Search className="h-4 w-4" /></Button>
              </form>
            </div>
          </CardContent>
        </Card>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
            ) : result.items.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center text-slate-500"><Database className="mb-3 h-10 w-10 text-slate-300" /><p>No records found</p></div>
            ) : section === "clinics" ? (
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="p-4">Clinic</th><th className="p-4">Contact</th><th className="p-4">Address</th><th className="p-4">Categories</th><th className="p-4">Doctors</th><th className="p-4">Status</th><th className="p-4">Created</th></tr></thead>
                <tbody className="divide-y">{result.items.map((clinic) => <tr key={clinic.clinic_id} className="align-top hover:bg-slate-50"><td className="p-4"><div className="font-semibold">{text(clinic.clinic_name)}</div><div className="text-xs text-slate-500">{text(clinic.clinic_id)}</div></td><td className="p-4"><div>{text(clinic.phone)}</div><div className="text-xs text-slate-500">{text(clinic.email)}</div></td><td className="max-w-xs p-4"><div>{text(clinic.address)}</div><div className="text-xs text-slate-500">{[clinic.city, clinic.pincode].filter(Boolean).join(" · ") || "—"}</div></td><td className="p-4">{(clinic.categories || []).join(", ") || text(clinic.category)}</td><td className="p-4">{clinic.doctors?.length ? clinic.doctors.map((doctor: any) => <div key={doctor.doctor_id} className="mb-1"><span className="font-medium">{doctor.name}</span><span className="text-xs text-slate-500"> {doctor.specialization ? `· ${doctor.specialization}` : ""}</span></div>) : "—"}</td><td className="p-4"><span className={`rounded-full px-2 py-1 text-xs ${clinic.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{clinic.is_active ? "Active" : "Inactive"}</span></td><td className="p-4 text-xs">{formatDate(clinic.created_at)}</td></tr>)}</tbody>
              </table>
            ) : section === "patients" ? (
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="p-4">Patient</th><th className="p-4">Contact</th><th className="p-4">Blood Group</th><th className="p-4">Visits</th><th className="p-4">Approved EMRs</th><th className="p-4">Registered</th></tr></thead>
                <tbody className="divide-y">{result.items.map((patient) => <tr key={patient.patient_id} className="hover:bg-slate-50"><td className="p-4"><div className="font-semibold">{text(patient.name)}</div><div className="text-xs text-slate-500">{text(patient.patient_id)}</div></td><td className="p-4"><div>{text(patient.phone)}</div><div className="text-xs text-slate-500">{text(patient.email)}</div></td><td className="p-4">{text(patient.blood_group)}</td><td className="p-4 font-semibold">{patient.visit_count || 0}</td><td className="p-4 font-semibold">{patient.approved_emr_count || 0}</td><td className="p-4 text-xs">{formatDate(patient.created_at)}</td></tr>)}</tbody>
              </table>
            ) : (
              <table className="w-full min-w-[1200px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="p-4">Clinic</th><th className="p-4">Patient</th><th className="p-4">Doctor</th><th className="p-4">Visit</th><th className="p-4">Queue</th><th className="p-4">EMR</th><th className="p-4">Served</th></tr></thead>
                <tbody className="divide-y">{result.items.map((visit) => <tr key={visit.appointment_id} className="align-top hover:bg-slate-50"><td className="p-4"><div className="font-semibold">{text(visit.clinic_name)}</div><div className="text-xs text-slate-500">{text(visit.clinic_id)}</div></td><td className="p-4"><div className="font-medium">{text(visit.patient_name)}</div><div className="text-xs text-slate-500">{text(visit.patient_id)} · {text(visit.patient_phone)}</div></td><td className="p-4">{text(visit.doctor_name)}</td><td className="p-4"><div>{text(visit.date)} · {text(visit.time)}</div><div className="text-xs text-slate-500">{text(visit.outcome)}</div></td><td className="p-4"><div>{visit.wait_time_minutes ?? "—"} min wait</div><div className="text-xs text-slate-500">{visit.consultation_duration_minutes ?? "—"} min consultation</div></td><td className="p-4"><div>{text(visit.emr_status)}</div><div className="text-xs text-slate-500">{text(visit.encounter_id)}</div></td><td className="p-4 text-xs">{formatDate(visit.served_at)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Showing {result.total === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, result.total)} of {result.total}</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => void fetchSection(section, dataToken, page - 1, search)}>Previous</Button><Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= result.total || loading} onClick={() => void fetchSection(section, dataToken, page + 1, search)}>Next</Button></div>
        </div>
      </main>
    </div>
  );
}
