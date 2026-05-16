import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Upload, Send, CheckCircle, XCircle, Clock, Mail, Phone, User, RefreshCw, Download, Package, ChevronDown, ChevronUp, Calendar, FileUp } from "lucide-react";
import { toast } from "sonner";

interface PendingReport {
  report_id: number;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  created_at: string;
  report_pdf: string | null;
  report_pdf_filename?: string | null;
  report_type: string | null;
}

const getReportPdfUrl = (pdfPath: string) => (
  `/api/clinic/reports/file?path=${encodeURIComponent(pdfPath)}`
);

const openReportPdf = (pdfPath: string) => {
  window.open(getReportPdfUrl(pdfPath), "_blank", "noopener,noreferrer");
};

// Expandable Card Component
const PendingReportCard = ({ 
  report, 
  processing, 
  selectedFiles, 
  onProcess, 
  onFileSelect,
  onUploadPdf,
  uploadingPdf 
}: {
  report: PendingReport;
  processing: number | null;
  selectedFiles: Record<number, File | undefined>;
  onProcess: (report: PendingReport, action: "send" | "collected" | "no_report", pdfPath?: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>, reportId: number) => void;
  onUploadPdf: (report: PendingReport) => Promise<string>;
  uploadingPdf: number | null;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfPath, setPdfPath] = useState<string | null>(report.report_pdf);
  const [pdfFilename, setPdfFilename] = useState<string | null>(report.report_pdf_filename || null);
  const selectedFile = selectedFiles[report.report_id];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] shadow-[0_18px_50px_-30px_rgba(19,55,50,0.45)]">
      {/* Header - always visible */}
      <div 
        className="cursor-pointer p-4 transition-colors hover:bg-[#00555A]/5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <div className="shrink-0 rounded-lg bg-[#00555A]/10 p-2">
              <User className="h-5 w-5 text-[#00555A]" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-[#0F172A]">{report.patient_name}</h3>
              <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                <span className="flex min-w-0 items-center gap-1">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{report.patient_email}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  <Phone className="h-3 w-3 shrink-0" />
                  <span className="truncate">{report.patient_phone}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
            <span className="rounded-full border border-[#FFC107]/40 bg-[#FFC107]/20 px-3 py-1 text-xs font-semibold text-[#7A5800]">
              Pending
            </span>
            {expanded ? (
                <ChevronUp className="h-5 w-5 text-[#00555A]" />
            ) : (
                <ChevronDown className="h-5 w-5 text-[#00555A]" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-[#e6ded3] bg-[#f0ede6] p-4">
          {/* Booking Details */}
          <div className="mb-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#00555A]">
              <Calendar className="h-4 w-4" />
              Appointment Details
            </h4>
            <div className="rounded-lg border border-[#e6ded3] bg-[#fffdf8] p-3 text-sm">
              <p className="text-[#0F172A]">
                <span className="font-medium">Booked on:</span> {formatDate(report.created_at)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Patient ID: {report.patient_id}
              </p>
            </div>
          </div>

          {/* PDF Upload Section */}
          <div className="mb-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#00555A]">
              <FileUp className="h-4 w-4" />
              Upload Report PDF
            </h4>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => onFileSelect(e, report.report_id)}
                className="min-w-0 flex-1 text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-[#00555A] file:px-4 file:py-2 file:text-white hover:file:bg-[#004448]"
              />
              {selectedFile && !pdfPath && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setUploading(true);
                    try {
                      const path = await onUploadPdf(report);
                      setPdfPath(path);
                      setPdfFilename(selectedFile?.name || null);
                      toast.success("PDF uploaded successfully!");
                    } catch (error: any) {
                      toast.error(error.message || "Failed to upload PDF");
                    } finally {
                      setUploading(false);
                    }
                  }}
                  disabled={uploading || uploadingPdf === report.report_id}
                  className="w-full border-[#00555A] text-[#00555A] hover:bg-[#00555A]/10 sm:w-auto"
                >
                  {uploading || uploadingPdf === report.report_id ? (
                    <div className="animate-spin h-4 w-4 border-2 border-[#00555A] border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload
                    </>
                  )}
                </Button>
              )}
            </div>
            {selectedFile && (
              <p className="mt-2 text-xs text-[#00555A]">
                Selected: {selectedFile.name}
              </p>
            )}
            {pdfPath && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-[#00555A]">
                  PDF uploaded: {pdfFilename || pdfPath.split('/').pop()}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openReportPdf(pdfPath)}
                  className="h-8 gap-1 border-[#00555A]/30 text-[#00555A] hover:bg-[#00555A]/10"
                >
                  <Download className="h-3.5 w-3.5" />
                  View Report
                </Button>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button
              onClick={() => onProcess(report, "send", pdfPath || undefined)}
              disabled={processing === report.report_id || uploading || (!pdfPath && !selectedFile)}
              size="sm"
              className="w-full gap-1 bg-[#00555A] text-white hover:bg-[#004448] sm:w-auto"
            >
              {processing === report.report_id ? (
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {selectedFile && !pdfPath ? "Upload & Send" : "Send PDF"}
                </>
              )}
            </Button>
            <Button
              onClick={() => onProcess(report, "collected")}
              disabled={processing === report.report_id}
              size="sm"
              variant="outline"
              className="w-full gap-1 border-[#00555A]/30 text-[#00555A] hover:bg-[#00555A]/10 sm:w-auto"
            >
              <CheckCircle className="h-4 w-4" />
              Collected
            </Button>
            <Button
              onClick={() => onProcess(report, "no_report")}
              disabled={processing === report.report_id}
              size="sm"
              variant="outline"
              className="w-full gap-1 border-[#d8d1c6] text-muted-foreground hover:bg-[#f0ede6] sm:w-auto"
            >
              <XCircle className="h-4 w-4" />
              No Report
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

interface CompletedReport {
  report_id: number;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  status: boolean;  // true = report provided, false = no report
  report_pdf: string | null;
  report_pdf_filename?: string | null;
  report_type: string | null;  // "sent", "collected", "no_report"
  completed_at: string;
}

interface ReportStats {
  pending: number;
  completed: number;
  provided: number;
  no_report: number;
  sent: number;
  collected: number;
  no_report_type: number;
}

const ClinicPatientReports = () => {
  const navigate = useNavigate();
  const clinicId = localStorage.getItem("clinic_id");

  const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);
  const [completedReports, setCompletedReports] = useState<CompletedReport[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState<number | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File | undefined>>({});
  const [notesMap, setNotesMap] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");

  useEffect(() => {
    if (clinicId) {
      fetchPendingReports();
      fetchCompletedReports();
      fetchStats();
    }
  }, [clinicId]);

  const fetchPendingReports = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clinic/reports/pending?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        setPendingReports(data.reports || []);
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to fetch pending reports");
      }
    } catch (error) {
      console.error("Error fetching pending reports:", error);
      toast.error("Failed to fetch pending reports");
    } finally {
      setLoading(false);
    }
  };

  const fetchCompletedReports = async () => {
    try {
      const response = await fetch(`/api/clinic/reports/completed?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        setCompletedReports(data.reports || []);
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to fetch completed reports");
      }
    } catch (error) {
      console.error("Error fetching completed reports:", error);
      toast.error("Failed to fetch completed reports");
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`/api/clinic/reports/statistics?clinic_id=${clinicId}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, reportId: number) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        toast.error("Only PDF files are allowed");
        return;
      }
      setSelectedFiles(prev => ({ ...prev, [reportId]: file }));
    }
  };

  const handleUploadPdf = async (report: PendingReport) => {
    const selectedFile = selectedFiles[report.report_id];
    if (!selectedFile) {
      toast.error("Please select a PDF file first");
      throw new Error("Please select a PDF file first");
    }

    setUploadingPdf(report.report_id);

    try {
      // Upload PDF
      const formData = new FormData();
      formData.append("file", selectedFile);

      const uploadResponse = await fetch(`/api/clinic/reports/upload-pdf?clinic_id=${clinicId}&patient_id=${report.patient_id}&report_id=${report.report_id}`, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.detail || "Failed to upload PDF");
      }

      const uploadData = await uploadResponse.json();
      toast.success("PDF uploaded successfully");
      setSelectedFiles(prev => {
        const next = { ...prev };
        delete next[report.report_id];
        return next;
      });

      // Update the report with the PDF path
      return uploadData.file_path;

    } catch (error: any) {
      console.error("Error uploading PDF:", error);
      toast.error(error.message || "Failed to upload PDF");
      throw error;
    } finally {
      setUploadingPdf(null);
    }
  };

  const handleProcessReport = async (report: PendingReport, action: "send" | "collected" | "no_report", pdfPath?: string) => {
    setProcessing(report.report_id);

    try {
      let finalPdfPath = pdfPath || report.report_pdf;
      const selectedFile = selectedFiles[report.report_id];
      const notes = notesMap[report.report_id] || "";

      // Send must include a PDF. If the clinic selected one, upload it first.
      if (action === "send" && selectedFile) {
        finalPdfPath = await handleUploadPdf(report);
      }

      if (action === "send" && !finalPdfPath) {
        toast.error("Please upload a PDF before sending");
        return;
      }

      const response = await fetch("/api/clinic/reports/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: report.report_id,
          action: action,
          pdf_path: finalPdfPath,
          notes: notes
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(action === "send" ? "PDF sent to patient email" : `Report ${action} successfully`);
        setSelectedFiles(prev => {
          const next = { ...prev };
          delete next[report.report_id];
          return next;
        });
        setNotesMap(prev => ({ ...prev, [report.report_id]: "" }));
        await fetchPendingReports();
        await fetchCompletedReports();
        await fetchStats();
      } else {
        const error = await response.json();
        toast.error(error.detail || "Failed to process report");
      }
    } catch (error: any) {
      console.error("Error processing report:", error);
      toast.error(error.message || "Failed to process report");
    } finally {
      setProcessing(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getReportTypeBadge = (reportType: string | null) => {
    if (!reportType) return null;

    const styles = {
      sent: "bg-[#00555A]/10 text-[#00555A] border-[#00555A]/20",
      collected: "bg-[#00555A]/10 text-[#00555A] border-[#00555A]/20",
      no_report: "bg-[#FFC107]/20 text-[#7A5800] border-[#FFC107]/40"
    };
    const labels = {
      sent: "Email Sent",
      collected: "Physical Collected",
      no_report: "No Report"
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${styles[reportType as keyof typeof styles]}`}>
        {labels[reportType as keyof typeof labels]}
      </span>
    );
  };

  const getStatusIcon = (status: boolean) => {
    return status ? (
      <CheckCircle className="h-5 w-5 text-[#00555A]" />
    ) : (
      <XCircle className="h-5 w-5 text-[#7A5800]" />
    );
  };

  return (
    <div className="min-h-screen bg-[#f5f3ee]">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[#e6ded3] bg-[#fbfaf7]/95 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate("/clinic")}
              className="shrink-0 rounded-lg bg-[#00555A]/10 p-2 text-[#00555A] transition-colors hover:bg-[#00555A]/15"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-[#0F172A] sm:text-xl">Patient Reports</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">Manage and send medical reports</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="shrink-0 rounded-lg border-[#00555A]/30 px-3 py-2 font-medium text-[#00555A] transition-all hover:bg-[#00555A]/10 sm:px-4"
            onClick={() => {
              fetchPendingReports();
              fetchCompletedReports();
              fetchStats();
            }}
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-4 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)] sm:p-5">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#00555A]/10">
                <FileText className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold text-[#0F172A] sm:text-3xl">{stats.pending}</p>
            </div>
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-4 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)] sm:p-5">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#00555A]/10">
                <CheckCircle className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Provided</p>
              <p className="text-2xl font-bold text-[#00555A] sm:text-3xl">{stats.provided}</p>
            </div>
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-4 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)] sm:p-5">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFC107]/20">
                <XCircle className="h-5 w-5 text-[#7A5800]" />
              </div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">No Report</p>
              <p className="text-2xl font-bold text-[#7A5800] sm:text-3xl">{stats.no_report}</p>
            </div>
            <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-4 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)] sm:p-5">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#00555A]/10">
                <Package className="h-5 w-5 text-[#00555A]" />
              </div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-[#00555A] sm:text-3xl">{stats.completed}</p>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mb-6 grid gap-2 sm:flex">
          <Button
            variant={activeTab === "pending" ? "default" : "outline"}
            onClick={() => setActiveTab("pending")}
            className={activeTab === "pending" ? "w-full bg-[#00555A] text-white hover:bg-[#004448] sm:w-auto" : "w-full border-[#00555A]/30 text-[#00555A] hover:bg-[#00555A]/10 sm:w-auto"}
          >
            Pending Reports ({stats?.pending || 0})
          </Button>
          <Button
            variant={activeTab === "completed" ? "default" : "outline"}
            onClick={() => setActiveTab("completed")}
            className={activeTab === "completed" ? "w-full bg-[#00555A] text-white hover:bg-[#004448] sm:w-auto" : "w-full border-[#00555A]/30 text-[#00555A] hover:bg-[#00555A]/10 sm:w-auto"}
          >
            Completed Reports ({stats?.completed || 0})
          </Button>
        </div>

        {/* Pending Reports */}
        {activeTab === "pending" && (
          <div className="space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-8 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)]">
                <div className="animate-spin h-8 w-8 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading pending reports...</p>
              </div>
            ) : pendingReports.length === 0 ? (
              <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-8 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)]">
                <FileText className="mx-auto mb-4 h-12 w-12 text-[#00555A]/35" />
                <p className="mb-2 font-medium text-[#0F172A]">No pending reports</p>
                <p className="text-sm text-muted-foreground">All patients have been processed</p>
              </div>
            ) : (
              pendingReports.map((report) => (
                <PendingReportCard 
                  key={report.report_id} 
                  report={report}
                  processing={processing}
                  selectedFiles={selectedFiles}
                  onProcess={handleProcessReport}
                  onFileSelect={handleFileSelect}
                  onUploadPdf={handleUploadPdf}
                  uploadingPdf={uploadingPdf}
                />
              ))
            )}
          </div>
        )}

        {/* Completed Reports */}
        {activeTab === "completed" && (
          <div className="space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-8 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)]">
                <div className="animate-spin h-8 w-8 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading completed reports...</p>
              </div>
            ) : completedReports.length === 0 ? (
              <div className="rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] p-8 text-center shadow-[0_18px_50px_-32px_rgba(19,55,50,0.45)]">
                <Package className="mx-auto mb-4 h-12 w-12 text-[#00555A]/35" />
                <p className="mb-2 font-medium text-[#0F172A]">No completed reports</p>
                <p className="text-sm text-muted-foreground">Processed reports will appear here</p>
              </div>
            ) : (
              completedReports.map((report) => (
                <div
                  key={report.report_id}
                  className="overflow-hidden rounded-2xl border border-[#e6ded3] bg-[#fbfaf7] shadow-[0_18px_50px_-30px_rgba(19,55,50,0.45)] transition-shadow hover:shadow-[0_20px_60px_-30px_rgba(19,55,50,0.55)]"
                >
                  {/* Patient Header */}
                  <div className="flex flex-col gap-3 border-b border-[#e6ded3] bg-gradient-to-r from-[#f0ede6] to-[#fbfaf7] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="shrink-0 rounded-lg bg-[#00555A]/10 p-2">
                        <User className="h-5 w-5 text-[#00555A]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-[#0F172A]">{report.patient_name}</h3>
                        <p className="text-xs text-muted-foreground">ID: {report.patient_id}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {getStatusIcon(report.status)}
                      {getReportTypeBadge(report.report_type)}
                    </div>
                  </div>

                  {/* Patient Content */}
                  <div className="p-4 sm:p-6">
                    <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
                      <div className="flex min-w-0 items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 shrink-0 text-[#00555A]" />
                        <span className="truncate text-muted-foreground">{report.patient_email}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 shrink-0 text-[#00555A]" />
                        <span className="truncate text-muted-foreground">{report.patient_phone}</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#e6ded3] bg-[#f0ede6] p-4">
                      <p className="mb-1 text-xs text-muted-foreground">Completed at:</p>
                      <p className="text-sm text-[#0F172A]">{formatDate(report.completed_at)}</p>
                    </div>

                    {/* Report Details */}
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">Report Status:</p>
                        <p className="text-sm font-medium text-[#0F172A]">
                          {report.status ? "Report Provided" : "No Report Needed"}
                        </p>
                      </div>
                      {report.report_pdf && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-2 border-[#00555A]/30 text-[#00555A] hover:bg-[#00555A]/10 sm:w-auto"
                          onClick={() => openReportPdf(report.report_pdf!)}
                        >
                          <Download className="h-4 w-4" />
                          View Report
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ClinicPatientReports;
