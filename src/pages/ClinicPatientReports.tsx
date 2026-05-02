import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Upload, Send, CheckCircle, XCircle, Clock, Mail, Phone, User, RefreshCw, Download, Package } from "lucide-react";
import { toast } from "sonner";

interface PendingReport {
  report_id: number;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  created_at: string;
  report_pdf: string | null;
  report_type: string | null;
}

interface CompletedReport {
  report_id: number;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  status: boolean;  // true = report provided, false = no report
  report_pdf: string | null;
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
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File>>({});
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
      return;
    }

    setUploadingPdf(report.report_id);

    try {
      // Upload PDF
      const formData = new FormData();
      formData.append("file", selectedFile);

      const uploadResponse = await fetch(`/api/clinic/reports/upload-pdf?clinic_id=${clinicId}&patient_id=${report.patient_id}`, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.detail || "Failed to upload PDF");
      }

      const uploadData = await uploadResponse.json();
      toast.success("PDF uploaded successfully");
      setSelectedFiles(prev => ({ ...prev, [report.report_id]: null }));

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

  const handleProcessReport = async (report: PendingReport, action: "send" | "collected" | "no_report") => {
    setProcessing(report.report_id);

    try {
      let pdfPath = report.report_pdf;
      const selectedFile = selectedFiles[report.report_id];
      const notes = notesMap[report.report_id] || "";

      // If action is "send" and no PDF uploaded, upload it first
      if (action === "send" && !pdfPath && selectedFile) {
        pdfPath = await handleUploadPdf(report);
      }

      const response = await fetch("/api/clinic/reports/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: report.report_id,
          action: action,
          pdf_path: pdfPath,
          notes: notes
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(`Report ${action} successfully`);
        setSelectedFiles(prev => ({ ...prev, [report.report_id]: null }));
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
      sent: "bg-green-100 text-green-700 border-green-200",
      collected: "bg-blue-100 text-blue-700 border-blue-200",
      no_report: "bg-slate-100 text-slate-700 border-slate-200"
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
      <CheckCircle className="h-5 w-5 text-green-600" />
    ) : (
      <XCircle className="h-5 w-5 text-slate-400" />
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/clinic")}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Patient Reports</h1>
              <p className="text-xs text-slate-500">Manage and send medical reports</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg font-medium transition-all"
            onClick={() => {
              fetchPendingReports();
              fetchCompletedReports();
              fetchStats();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Pending</p>
              <p className="text-3xl font-bold text-slate-800">{stats.pending}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-green-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Provided</p>
              <p className="text-3xl font-bold text-green-600">{stats.provided}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-slate-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <XCircle className="h-5 w-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">No Report</p>
              <p className="text-3xl font-bold text-slate-600">{stats.no_report}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-5 text-center">
              <div className="bg-blue-100 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2">
                <Package className="h-5 w-5 text-blue-600" />
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">Completed</p>
              <p className="text-3xl font-bold text-blue-600">{stats.completed}</p>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "pending" ? "default" : "outline"}
            onClick={() => setActiveTab("pending")}
            className={activeTab === "pending" ? "bg-[#00555A] text-white" : "border-slate-300 text-slate-600"}
          >
            Pending Reports ({stats?.pending || 0})
          </Button>
          <Button
            variant={activeTab === "completed" ? "default" : "outline"}
            onClick={() => setActiveTab("completed")}
            className={activeTab === "completed" ? "bg-[#00555A] text-white" : "border-slate-300 text-slate-600"}
          >
            Completed Reports ({stats?.completed || 0})
          </Button>
        </div>

        {/* Pending Reports */}
        {activeTab === "pending" && (
          <div className="space-y-4">
            {loading ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <div className="animate-spin h-8 w-8 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-600">Loading pending reports...</p>
              </div>
            ) : pendingReports.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium mb-2">No pending reports</p>
                <p className="text-sm text-slate-500">All patients have been processed</p>
              </div>
            ) : (
              pendingReports.map((report) => (
                <div
                  key={report.report_id}
                  className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Patient Header */}
                  <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-100 p-2 rounded-lg">
                        <User className="h-5 w-5 text-slate-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">{report.patient_name}</h3>
                        <p className="text-xs text-slate-500">ID: {report.patient_id}</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border-amber-200">
                      Pending
                    </span>
                  </div>

                  {/* Patient Content */}
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{report.patient_email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{report.patient_phone}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 mb-4">
                      <p className="text-xs text-slate-500 mb-1">Created at:</p>
                      <p className="text-sm text-slate-700">{formatDate(report.created_at)}</p>
                    </div>

                    {/* PDF Upload Section */}
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Upload Report PDF (for email)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => handleFileSelect(e, report.report_id)}
                          className="flex-1 text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
                        />
                        {report.report_pdf && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => {
                              // Download PDF logic here if needed
                              toast.info("PDF already uploaded");
                            }}
                          >
                            <Download className="h-4 w-4" />
                            View PDF
                          </Button>
                        )}
                      </div>
                      {report.report_pdf && (
                        <p className="text-xs text-green-600 mt-2">
                          ✓ PDF uploaded: {report.report_pdf.split('/').pop()}
                        </p>
                      )}
                      {selectedFiles[report.report_id] && (
                        <p className="text-xs text-blue-600 mt-2">
                          Selected: {selectedFiles[report.report_id].name}
                        </p>
                      )}
                    </div>

                    {/* Notes Section */}
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Notes (optional)
                      </label>
                      <textarea
                        value={notesMap[report.report_id] || ""}
                        onChange={(e) => setNotesMap(prev => ({ ...prev, [report.report_id]: e.target.value }))}
                        placeholder="Add any notes about this report..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-[#00555A] focus:ring-2 focus:ring-[#00555A]/20 resize-none"
                        rows={2}
                      />
                    </div>

                    {/* Action Buttons - 3 Small Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => handleProcessReport(report, "send")}
                        disabled={processing === report.report_id}
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white gap-2"
                      >
                        {processing === report.report_id ? (
                          <>
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Send
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleProcessReport(report, "collected")}
                        disabled={processing === report.report_id}
                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white gap-2"
                      >
                        {processing === report.report_id ? (
                          <>
                            <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4" />
                            Collected
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleProcessReport(report, "no_report")}
                        disabled={processing === report.report_id}
                        variant="outline"
                        className="flex-1 border-slate-300 text-slate-600 hover:bg-slate-50 gap-2"
                      >
                        {processing === report.report_id ? (
                          <>
                            <div className="animate-spin h-4 w-4 border-2 border-slate-300 border-t-transparent rounded-full" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4" />
                            No Report
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Completed Reports */}
        {activeTab === "completed" && (
          <div className="space-y-4">
            {loading ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <div className="animate-spin h-8 w-8 border-2 border-[#00555A] border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-600">Loading completed reports...</p>
              </div>
            ) : completedReports.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <Package className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium mb-2">No completed reports</p>
                <p className="text-sm text-slate-500">Processed reports will appear here</p>
              </div>
            ) : (
              completedReports.map((report) => (
                <div
                  key={report.report_id}
                  className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Patient Header */}
                  <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-100 p-2 rounded-lg">
                        <User className="h-5 w-5 text-slate-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">{report.patient_name}</h3>
                        <p className="text-xs text-slate-500">ID: {report.patient_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(report.status)}
                      {getReportTypeBadge(report.report_type)}
                    </div>
                  </div>

                  {/* Patient Content */}
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{report.patient_email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{report.patient_phone}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs text-slate-500 mb-1">Completed at:</p>
                      <p className="text-sm text-slate-700">{formatDate(report.completed_at)}</p>
                    </div>

                    {/* Report Details */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Report Status:</p>
                        <p className="text-sm font-medium text-slate-700">
                          {report.status ? "Report Provided" : "No Report Needed"}
                        </p>
                      </div>
                      {report.report_pdf && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          onClick={() => {
                            // Download PDF logic here if needed
                            toast.info("PDF available for download");
                          }}
                        >
                          <Download className="h-4 w-4" />
                          View PDF
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
