import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileText, Upload } from "lucide-react";
import { apiUrl } from "@/lib/api";

type HealthDocument = {
  id: number;
  filename: string;
  document_type: string;
  source: string;
  processing_status: string;
  created_at: string;
};

const getPatientId = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    return user.patient_id || user.id || "";
  } catch {
    return "";
  }
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Uploaded"
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export default function PatientHealthRecords() {
  const patientId = useMemo(getPatientId, []);
  const [documents, setDocuments] = useState<HealthDocument[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!patientId) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(apiUrl(`/api/patient-health/documents?patient_id=${encodeURIComponent(patientId)}`));
      if (!response.ok) throw new Error("Could not load your records");
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load your records");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setMessage(null);
  };

  const uploadDocument = async () => {
    if (!patientId || !selectedFile) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch(
        apiUrl(`/api/patient-health/documents?patient_id=${encodeURIComponent(patientId)}&document_type=medical_report`),
        { method: "POST", body: form },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Upload failed");
      setSelectedFile(null);
      setMessage("Report uploaded safely.");
      await loadDocuments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent">
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-8 pt-5 sm:max-w-xl sm:px-6 md:max-w-2xl">
        <header className="flex items-center gap-3">
          <Link to="/patient" className="grid h-11 w-11 place-items-center rounded-2xl bg-white/80 text-[#17312d]" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary/70">Health records</p>
            <h1 className="font-display text-2xl font-bold text-[#17312d]">Medical reports</h1>
          </div>
        </header>

        <section className="rounded-[26px] border border-white/70 bg-white/80 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff0bf] text-[#7a5800]"><Upload className="h-5 w-5" /></span>
            <div><h2 className="font-bold text-slate-950">Upload a medical report</h2><p className="text-sm text-slate-500">PDF, JPG or PNG · up to 10 MB</p></div>
          </div>
          <label className="mt-4 block cursor-pointer rounded-2xl border border-dashed border-[#b8c9c3] bg-[#f7faf8] p-4 text-center text-sm font-bold text-[#40514b]">
            {selectedFile ? selectedFile.name : "Choose report from your device"}
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={chooseFile} />
          </label>
          <button
            type="button"
            disabled={!selectedFile || uploading || !patientId}
            onClick={() => void uploadDocument()}
            className="mt-3 w-full rounded-2xl bg-[#1a5c4a] px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload report"}
          </button>
          {message ? <p className="mt-3 rounded-xl bg-[#f6f1e8] px-3 py-2 text-sm font-semibold text-[#40514b]">{message}</p> : null}
        </section>

        <section className="rounded-[26px] border border-white/70 bg-white/80 p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-bold text-slate-950">Your uploaded records</h2><span className="rounded-full bg-[#e1f5ee] px-3 py-1 text-xs font-bold text-[#1a5c4a]">{documents.length}</span></div>
          {loading ? <p className="mt-4 text-sm text-slate-500">Loading records...</p> : documents.length ? (
            <div className="mt-4 space-y-2">
              {documents.map((document) => (
                <a key={document.id} href={apiUrl(`/api/patient-health/documents/${document.id}/file?patient_id=${encodeURIComponent(patientId)}`)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-[#f6f1e8] p-3">
                  <FileText className="h-5 w-5 shrink-0 text-[#1a5c4a]" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-[#202825]">{document.filename}</span><span className="block text-xs text-[#77756f]">{formatDate(document.created_at)}</span></span>
                  <CheckCircle2 className="h-4 w-4 text-[#1a5c4a]" />
                </a>
              ))}
            </div>
          ) : <p className="mt-4 rounded-2xl bg-[#f6f1e8] p-4 text-sm text-slate-500">No reports uploaded yet.</p>}
        </section>
      </main>
    </div>
  );
}
