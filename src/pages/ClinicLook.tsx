import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Calendar, Mail, Phone, UserCircle, Eye, FileText, Loader2, ShieldCheck } from "lucide-react";
import { apiUrl } from "@/lib/api";

interface PatientSearchResult {
  appointment_token: string;
  patient_name: string;
  patient_phone: string;
  patient_id: string;
  patient_email: string;
  date: string;
  time: string;
  status: string;
}

interface EhrEncounter {
  encounter_id: string;
  status: string;
  doctor_id?: string | null;
  ehr_data: Record<string, unknown>;
  patient_summary: Record<string, unknown>;
  approved_at?: string | null;
  created_at: string;
}

interface PatientEhrData {
  patient: { patient_id: string; name: string; phone: string; blood_group?: string | null };
  encounters: EhrEncounter[];
}

const displayList = (value: unknown) => Array.isArray(value) && value.length ? value.join(", ") : "Not recorded";

const ClinicLook = () => {
  const [clinicProfile, setClinicProfile] = useState<any>(null);
  const [message, setMessage] = useState<{text: string; type: "success" | "error"} | null>(null);
  
  // Search states
  const [searchType, setSearchType] = useState<"date" | "patient_id" | "email" | "phone" | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [patientId, setPatientId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [searchCount, setSearchCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [ehrData, setEhrData] = useState<PatientEhrData | null>(null);
  const [ehrLoading, setEhrLoading] = useState(false);

  // Get clinic ID from localStorage
  const getClinicId = () => {
    try {
      return localStorage.getItem("clinic_id");
    } catch (error) {
      setMessage({text: "Error getting clinic_id", type: "error"});
      return null;
    }
  };

  // Fetch clinic data
  useEffect(() => {
    const fetchClinicData = async () => {
      const clinicId = getClinicId();
      if (!clinicId) return;

      try {
        const response = await fetch(`/api/auth/clinic/data?clinic_id=${clinicId}`);
        if (response.ok) {
          const data = await response.json();
          setClinicProfile(data);
        }
      } catch (error) {
        setMessage({text: "Error fetching clinic data", type: "error"});
      }
    };

    fetchClinicData();
  }, []);

  // Search patients
  const handleSearch = async () => {
    const clinicId = getClinicId();
    if (!clinicId) return;

    setSearching(true);
    try {
      let url = `/api/auth/clinic/patients/search?clinic_id=${clinicId}`;
      
      if (searchType === "date" && fromDate && toDate) {
        url += `&from_date=${fromDate}&to_date=${toDate}`;
      } else if (searchType === "patient_id" && patientId) {
        url += `&patient_id=${patientId}`;
      } else if (searchType === "email" && email) {
        url += `&email=${email}`;
      } else if (searchType === "phone" && phone) {
        url += `&phone=${phone}`;
      }

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.patients || []);
        setSearchCount(data.total || 0);
      }
    } catch (error) {
      setMessage({text: "Error searching patients", type: "error"});
    } finally {
      setSearching(false);
    }
  };

  const viewEhr = async (selectedPatient: PatientSearchResult) => {
    const clinicId = getClinicId();
    if (!clinicId) return;
    if (selectedPatientId === selectedPatient.patient_id) {
      setSelectedPatientId("");
      setEhrData(null);
      return;
    }
    setSelectedPatientId(selectedPatient.patient_id);
    setEhrData(null);
    setEhrLoading(true);
    setMessage(null);
    try {
      const response = await fetch(apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(selectedPatient.patient_id)}`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not load this patient's EHR");
      setEhrData(payload);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not load this patient's EHR", type: "error" });
      setSelectedPatientId("");
    } finally {
      setEhrLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/60 bg-[#fbfaf7]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4">
          <Link
            to="/clinic"
            className="-ml-2 flex shrink-0 items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm font-medium">Dashboard</span>
          </Link>
          <span className="font-semibold text-foreground">Look</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
        <h1 className="mb-5 text-2xl font-bold text-foreground sm:mb-6">Search Patients</h1>

        {message ? <div className={`mb-4 rounded-2xl p-4 text-sm font-semibold ${message.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{message.text}</div> : null}

        {/* Search Type Buttons */}
        <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:gap-3">
          <Button
            variant={searchType === "date" ? "default" : "outline"}
            size="lg"
            onClick={() => setSearchType("date")}
            className="w-full justify-start gap-2 lg:w-auto"
          >
            <Calendar className="h-5 w-5" />
            By Date Range
          </Button>
          <Button
            variant={searchType === "patient_id" ? "default" : "outline"}
            size="lg"
            onClick={() => setSearchType("patient_id")}
            className="w-full justify-start gap-2 lg:w-auto"
          >
            <UserCircle className="h-5 w-5" />
            By Patient ID
          </Button>
          <Button
            variant={searchType === "email" ? "default" : "outline"}
            size="lg"
            onClick={() => setSearchType("email")}
            className="w-full justify-start gap-2 lg:w-auto"
          >
            <Mail className="h-5 w-5" />
            By Email
          </Button>
          <Button
            variant={searchType === "phone" ? "default" : "outline"}
            size="lg"
            onClick={() => setSearchType("phone")}
            className="w-full justify-start gap-2 lg:w-auto"
          >
            <Phone className="h-5 w-5" />
            By Phone
          </Button>
        </div>

        {/* Search Panel */}
        {searchType && (
          <div className="mb-6 rounded-[24px] border border-white/70 bg-white/80 backdrop-blur p-4 shadow-sm sm:p-6">
            {/* Search Inputs */}
            {searchType === "date" && (
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">From Date</label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">To Date</label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            {searchType === "patient_id" && (
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1 block">Patient ID</label>
                <Input
                  placeholder="Enter patient ID (e.g., PA-1234567890)"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                />
              </div>
            )}

            {searchType === "email" && (
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1 block">Email Address</label>
                <Input
                  type="email"
                  placeholder="Enter patient email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}

            {searchType === "phone" && (
              <div className="mb-4">
                <label className="text-sm text-muted-foreground mb-1 block">Phone Number</label>
                <Input
                  placeholder="Enter patient phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            <Button 
              onClick={handleSearch} 
              disabled={searching} 
              className="w-full"
              size="lg"
            >
              {searching ? "Searching..." : "Search"}
            </Button>
          </div>
        )}

        {/* Results */}
        {searchCount > 0 && (
          <div className="rounded-[24px] border border-white/70 bg-white/80 backdrop-blur p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold mb-4">
              Found <span className="text-[#00555A]">{searchCount}</span> patients
            </h2>
            <div className="space-y-3">
              {searchResults.map((patient, idx) => (
                <div key={idx} className="rounded-2xl border border-[#e6ded3] bg-[#f6f1e8] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <span className="block truncate text-lg font-semibold">{patient.patient_name}</span>
                      <p className="text-muted-foreground text-sm mt-1">
                        ID: {patient.patient_id}
                      </p>
                      <p className="mt-1 flex min-w-0 flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                        <span className="truncate">{patient.patient_email}</span>
                        <span className="hidden sm:inline">-</span>
                        <span className="truncate">{patient.patient_phone}</span>
                      </p>
                    </div>
                    <span className="shrink-0 self-start rounded-2xl bg-[#00555A]/10 px-3 py-1 text-lg font-bold text-[#00555A]">
                      {patient.appointment_token}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-3 border-t border-[#e6ded3] pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">{patient.date}</span> at <span className="font-medium">{patient.time}</span>
                    </div>
                    <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${
                      patient.status === 'completed' ? 'bg-green-100 text-green-700' :
                      patient.status === 'waiting' ? 'bg-amber-100 text-amber-700' :
                      patient.status === 'booked' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {patient.status}
                    </span>
                  </div>
                  <Button variant="outline" onClick={() => viewEhr(patient)} className="mt-3 w-full border-[#a9cfc0] bg-white text-[#1a5c4a] hover:bg-[#edf8f3]">
                    {ehrLoading && selectedPatientId === patient.patient_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    {selectedPatientId === patient.patient_id ? "Hide EHR" : "View patient EHR"}
                  </Button>
                </div>
              ))}
            </div>

            {selectedPatientId && ehrData ? (
              <section className="mt-5 overflow-hidden rounded-[24px] border border-[#b9ddcf] bg-[#f4fbf8]">
                <div className="border-b border-[#d5e9e1] p-4">
                  <p className="flex items-center gap-2 font-bold text-[#17312d]"><ShieldCheck className="h-5 w-5" /> {ehrData.patient.name}'s EHR</p>
                  <p className="mt-1 text-xs text-[#60766f]">Patient ID {ehrData.patient.patient_id} · Blood group {ehrData.patient.blood_group || "not recorded"}</p>
                </div>
                <div className="space-y-3 p-4">
                  {ehrData.encounters.length ? ehrData.encounters.map((encounter) => {
                    const ehr = encounter.ehr_data;
                    return <article key={encounter.encounter_id} className="rounded-2xl bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-black text-[#202825]">{new Date(encounter.approved_at || encounter.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${encounter.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{encounter.status}</span>
                      </div>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Chief complaint</dt><dd className="mt-1 text-[#202825]">{String(ehr.chief_complaint || "Not recorded")}</dd></div>
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Diagnosis</dt><dd className="mt-1 text-[#202825]">{displayList(ehr.diagnoses)}</dd></div>
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Allergies</dt><dd className="mt-1 text-[#202825]">{displayList(ehr.allergies)}</dd></div>
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Medicines prescribed</dt><dd className="mt-1 text-[#202825]">{displayList(ehr.prescriptions)}</dd></div>
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Tests</dt><dd className="mt-1 text-[#202825]">{displayList(ehr.investigations)}</dd></div>
                        <div><dt className="text-xs font-bold uppercase tracking-wide text-[#6b7d77]">Follow-up</dt><dd className="mt-1 text-[#202825]">{String(ehr.follow_up || "Not recorded")}</dd></div>
                      </dl>
                    </article>;
                  }) : <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#68736f]">No EHR has been created for this patient at this clinic yet.</div>}
                </div>
              </section>
            ) : null}
          </div>
        )}

        {/* No results */}
        {searchType && searchCount === 0 && !searching && (
          <div className="rounded-[24px] border border-dashed border-white/70 bg-white/70 backdrop-blur py-10 text-center text-muted-foreground sm:py-12">
            <Eye className="mx-auto h-12 w-12 mb-3" />
            <p>No patients found matching your search.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClinicLook;
