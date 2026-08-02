import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Calendar, Mail, Phone, UserCircle, Eye, FileText, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { apiUrl, clinicAuthHeaders } from "@/lib/api";

interface PatientSearchResult {
  appointment_token: string;
  encounter_id?: string | null;
  patient_name: string;
  patient_phone: string;
  patient_id: string;
  patient_email: string;
  date: string;
  time: string;
  status: string;
  source?: string;
}

const ClinicLook = () => {
  const navigate = useNavigate();
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
  const [expandedPatientId, setExpandedPatientId] = useState("");
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

      const response = await fetch(apiUrl(url), { headers: clinicAuthHeaders() });
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

  // Group search results by patient_id
  const groupedPatients = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; email: string; patient_id: string; visits: PatientSearchResult[] }>();
    for (const r of searchResults) {
      const key = r.patient_id;
      if (!map.has(key)) {
        map.set(key, { name: r.patient_name, phone: r.patient_phone, email: r.patient_email, patient_id: r.patient_id, visits: [] });
      }
      map.get(key)!.visits.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.visits.length - a.visits.length);
  }, [searchResults]);

  const togglePatient = (patientId: string) => {
    if (expandedPatientId === patientId) {
      setExpandedPatientId("");
      return;
    }
    setExpandedPatientId(patientId);
  };

  const saveSearchState = () => {
    try {
      sessionStorage.setItem("clinicLookState", JSON.stringify({
        searchType, fromDate, toDate, patientId, email, phone,
        searchResults, searchCount, expandedPatientId,
      }));
    } catch { /* sessionStorage may be full */ }
  };

  // Restore search state on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("clinicLookState");
      if (saved) {
        const state = JSON.parse(saved);
        if (state.searchType) setSearchType(state.searchType);
        if (state.fromDate) setFromDate(state.fromDate);
        if (state.toDate) setToDate(state.toDate);
        if (state.patientId) setPatientId(state.patientId);
        if (state.email) setEmail(state.email);
        if (state.phone) setPhone(state.phone);
        if (state.searchResults) setSearchResults(state.searchResults);
        if (state.searchCount !== undefined) setSearchCount(state.searchCount);
        if (state.expandedPatientId) setExpandedPatientId(state.expandedPatientId);
        sessionStorage.removeItem("clinicLookState");
      }
    } catch { /* ignore parse errors */ }
  }, []);

  const viewEhr = async (visit: PatientSearchResult) => {
    const clinicId = getClinicId();
    if (!clinicId) return;
    if (visit.encounter_id) {
      saveSearchState();
      navigate(`/clinic/patients/${encodeURIComponent(visit.patient_id)}/encounters/${encodeURIComponent(visit.encounter_id)}/ehr`);
      return;
    }
    setEhrLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        apiUrl(`/api/ehr/clinic/${encodeURIComponent(clinicId)}/patient/${encodeURIComponent(visit.patient_id)}`),
        { headers: clinicAuthHeaders() },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not load this patient's EHR");
      }
      const payload = await response.json();
      const encounters = Array.isArray(payload.encounters) ? payload.encounters : [];
      const normalizedTime = (value: unknown) => String(value || "").slice(0, 5);
      // Match the stable token first. Historical appointments are removed from
      // the live table, so their EHR falls back to the stored visit date/time.
      const enc = encounters.find((e: any) =>
        e.visit?.appointment_token && e.visit.appointment_token === visit.appointment_token
      ) || encounters.find((e: any) =>
        e.visit?.date === visit.date && normalizedTime(e.visit?.time) === normalizedTime(visit.time)
      ) || encounters.find((e: any) => {
        const storedDateTime = e.ehr_data?.visit_details?.visit_datetime;
        return typeof storedDateTime === "string" &&
          storedDateTime.slice(0, 10) === visit.date &&
          normalizedTime(storedDateTime.split("T")[1]) === normalizedTime(visit.time);
      });
      if (!enc) {
        setMessage({ text: "No EHR recorded for this visit.", type: "error" });
        setEhrLoading(false);
        return;
      }
      saveSearchState();
      navigate(`/clinic/patients/${encodeURIComponent(visit.patient_id)}/encounters/${encodeURIComponent(enc.encounter_id)}/ehr`);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not load this patient's EHR", type: "error" });
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
              Found <span className="text-[#00555A]">{groupedPatients.length}</span> patient{groupedPatients.length !== 1 ? "s" : ""} · <span className="text-sm font-normal text-muted-foreground">{searchCount} total visit{searchCount !== 1 ? "s" : ""}</span>
            </h2>
            <div className="space-y-3">
              {groupedPatients.map((group) => {
                const isExpanded = expandedPatientId === group.patient_id;
                return (
                  <div key={group.patient_id} className="rounded-2xl border border-[#e6ded3] bg-[#f6f1e8] overflow-hidden">
                    <button type="button" onClick={() => togglePatient(group.patient_id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-semibold">{group.name}</span>
                        <p className="text-muted-foreground text-sm mt-1">
                          ID: {group.patient_id}
                        </p>
                        <p className="mt-1 flex min-w-0 flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                          <span className="truncate">{group.email}</span>
                          <span className="hidden sm:inline">-</span>
                          <span className="truncate">{group.phone}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="rounded-2xl bg-[#00555A]/10 px-3 py-1 text-sm font-bold text-[#00555A]">{group.visits.length} visit{group.visits.length !== 1 ? "s" : ""}</span>
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-[#68736f]" /> : <ChevronRight className="h-5 w-5 text-[#68736f]" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#e6ded3] bg-white">
                        <div className="divide-y divide-[#e6ded3]">
                          {group.visits.map((visit, idx) => {
                            return (
                            <div key={visit.encounter_id || `${visit.appointment_token}-${visit.date}-${visit.time}-${idx}`} className="p-4">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="text-sm text-muted-foreground">
                                  <span className="font-medium text-[#202825]">{visit.date}</span> at <span className="font-medium text-[#202825]">{visit.time}</span>
                                  <span className="mx-2 text-[#c5beb2]">·</span>
                                  <span className="rounded-2xl bg-[#00555A]/10 px-2.5 py-0.5 font-bold text-[#00555A]">{visit.appointment_token || "EHR"}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                    visit.source === 'online' ? 'bg-blue-100 text-blue-700' :
                                    visit.source === 'walkin' ? 'bg-purple-100 text-purple-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>
                                    {visit.source || "appointment"}
                                  </span>
                                  <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${
                                    visit.status === 'completed' ? 'bg-green-100 text-green-700' :
                                    visit.status === 'waiting' ? 'bg-amber-100 text-amber-700' :
                                    visit.status === 'booked' ? 'bg-blue-100 text-blue-700' :
                                    'bg-gray-100 text-gray-700'
                                  }`}>
                                    {visit.status}
                                  </span>
                                </div>
                              </div>
                              <Button variant="outline" onClick={() => viewEhr(visit)} className="mt-2 w-full border-[#a9cfc0] bg-white text-[#1a5c4a] hover:bg-[#edf8f3] sm:w-auto">
                                {ehrLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                                View EHR
                              </Button>
                            </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
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
