import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, Calendar, Mail, Phone, UserCircle, Eye } from "lucide-react";

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

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#e6ded3] bg-[#fbfaf7]/95 backdrop-blur">
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
          <div className="mb-6 rounded-xl border border-[#e6ded3] bg-[#fbfaf7] p-4 shadow-sm sm:p-6">
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
          <div className="rounded-xl border border-[#e6ded3] bg-[#fbfaf7] p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold mb-4">
              Found <span className="text-[#00555A]">{searchCount}</span> patients
            </h2>
            <div className="space-y-3">
              {searchResults.map((patient, idx) => (
                <div key={idx} className="rounded-lg border border-[#e6ded3] bg-[#f0ede6] p-4">
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
                    <span className="shrink-0 self-start rounded-lg bg-[#00555A]/10 px-3 py-1 text-lg font-bold text-[#00555A]">
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
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No results */}
        {searchType && searchCount === 0 && !searching && (
          <div className="rounded-xl border border-dashed border-[#d8d1c6] bg-[#fbfaf7]/80 py-10 text-center text-muted-foreground sm:py-12">
            <Eye className="mx-auto h-12 w-12 mb-3" />
            <p>No patients found matching your search.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClinicLook;
