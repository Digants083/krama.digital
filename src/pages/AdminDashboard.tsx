import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  MessageSquare,
  LogOut,
  LayoutDashboard,
  Users,
  CheckCircle,
  Clock,
  XCircle,
  Search,
  Loader2,
  AlertCircle,
  MapPin,
  Mail,
  Phone,
  User
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ClinicData {
  id: number;
  clinic_id: string;
  clinic_name: string;
  email: string;
  phone: string;
  category: string | null;
  street_address: string | null;
  road: string | null;
  layout: string | null;
  section: string | null;
  city: string | null;
  pincode: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  doctor_name: string | null;
  specialization: string | null;
  experience: string | null;
  qualifications: string | null;
  image_urls: string[];
  status?: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at?: string;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  available?: boolean;
  is_active?: boolean;
}

interface FeedbackItem {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface DashboardStats {
  pending_registrations: number;
  approved_registrations: number;
  rejected_registrations: number;
  total_active_clinics: number;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const adminToken = sessionStorage.getItem("admin_token");
  const adminId = sessionStorage.getItem("admin_id");
  const adminUsername = sessionStorage.getItem("admin_username") || "Admin";

  // View state: 'dashboard' (main menu), 'approvals', or 'feedback'
  const [currentView, setCurrentView] = useState<"dashboard" | "approvals" | "feedback">("dashboard");

  // Secure session validation
  useEffect(() => {
    const adminLoggedIn = sessionStorage.getItem("admin_logged_in");
    const sessionTime = sessionStorage.getItem("admin_session_time");

    const isValidSession = adminToken && adminLoggedIn && adminId && sessionTime;
    const sessionAge = isValidSession ? Date.now() - parseInt(sessionTime) : 0;
    const maxSessionAge = 24 * 60 * 60 * 1000;

    if (!isValidSession || sessionAge > maxSessionAge) {
      sessionStorage.removeItem("admin_token");
      sessionStorage.removeItem("admin_logged_in");
      sessionStorage.removeItem("admin_username");
      sessionStorage.removeItem("admin_id");
      sessionStorage.removeItem("admin_session_time");
      navigate("/admin/login", { replace: true });
    }
  }, [navigate, adminToken, adminId]);

  const getAdminHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${adminToken ?? ""}`,
  });

  const handleLogout = () => {
    sessionStorage.removeItem("admin_token");
    sessionStorage.removeItem("admin_logged_in");
    sessionStorage.removeItem("admin_username");
    sessionStorage.removeItem("admin_id");
    sessionStorage.removeItem("admin_session_time");
    navigate("/admin/login", { replace: true });
  };

  // ==================== APPROVALS STATE ====================
  const [registrations, setRegistrations] = useState<ClinicData[]>([]);
  const [approvedClinics, setApprovedClinics] = useState<ClinicData[]>([]);
  const [rejectedClinics, setRejectedClinics] = useState<ClinicData[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReg, setSelectedReg] = useState<ClinicData | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");
  const [searchTerm, setSearchTerm] = useState("");

  const API_BASE = "/api/admin";

  const fetchRegistrations = async (tab: string) => {
    try {
      if (tab === "pending") {
        const response = await fetch(`${API_BASE}/pending-registrations?status=pending`, {
          headers: getAdminHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch registrations");
        const data = await response.json();
        setRegistrations(data.registrations || []);
      } else if (tab === "approved") {
        const response = await fetch(`${API_BASE}/approved-clinics`, {
          headers: getAdminHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch approved clinics");
        const data = await response.json();
        setApprovedClinics(data.clinics || []);
      } else if (tab === "rejected") {
        const response = await fetch(`${API_BASE}/rejected-clinics`, {
          headers: getAdminHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch rejected clinics");
        const data = await response.json();
        setRejectedClinics(data.clinics || []);
      } else {
        const response = await fetch(`${API_BASE}/pending-registrations`, {
          headers: getAdminHeaders(),
        });
        if (!response.ok) throw new Error("Failed to fetch registrations");
        const data = await response.json();
        setRegistrations(data.registrations || []);
      }
    } catch (error) {
      toast.error("Failed to load data");
      console.error(error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/statistics`, {
        headers: getAdminHeaders(),
      });
      if (!response.ok) throw new Error("Failed to fetch statistics");
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([
        fetchRegistrations(activeTab),
        fetchStats()
      ]);
      setLoading(false);
    };
    loadData();
  }, [activeTab]);

  const handleApprove = async (reg: ClinicData) => {
    setActionLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/pending-registrations/${reg.id}/approve?admin_id=${adminId}`,
        {
          method: "POST",
          headers: getAdminHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to approve registration");
      }

      const data = await response.json();
      toast.success(`Approved ${reg.clinic_name}. Email sent: ${data.email_sent ? "Yes" : "No"}`);

      await Promise.all([
        fetchRegistrations(activeTab === "all" ? undefined : activeTab),
        fetchStats()
      ]);
      setSelectedReg(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to approve");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (reg: any) => {
    setActionLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/pending-registrations/${reg.id}/reject?admin_id=${adminId}&reason=${encodeURIComponent(rejectionReason)}`,
        {
          method: "POST",
          headers: getAdminHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to reject registration");
      }

      const data = await response.json();
      toast.success(`Rejected ${reg.clinic_name}. Email sent: ${data.email_sent ? "Yes" : "No"}`);

      await Promise.all([
        fetchRegistrations(activeTab === "all" ? undefined : activeTab),
        fetchStats()
      ]);
      setSelectedReg(null);
      setRejectionReason("");
    } catch (error: any) {
      toast.error(error.message || "Failed to reject");
    } finally {
      setActionLoading(false);
    }
  };

  const getCurrentData = () => {
    if (activeTab === "approved") return approvedClinics;
    if (activeTab === "rejected") return rejectedClinics;
    return registrations;
  };

  const filteredRegistrations = getCurrentData().filter(reg =>
    reg.clinic_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reg.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reg.address?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200"><Clock className="w-3 h-3 mr-1 inline" /> Pending</span>;
      case "approved":
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3 mr-1 inline" /> Approved</span>;
      case "rejected":
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200"><XCircle className="w-3 h-3 mr-1 inline" /> Rejected</span>;
      default:
        return <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">{status}</span>;
    }
  };

  // ==================== FEEDBACK STATE ====================
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const fetchAllFeedback = async () => {
    setFeedbackLoading(true);
    try {
      const response = await fetch("/api/feedback/all");
      if (response.ok) {
        const data = await response.json();
        setFeedbackList(data.feedback || []);
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
    } finally {
      setFeedbackLoading(false);
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

  // ==================== MAIN DASHBOARD VIEW ====================
  if (currentView === "dashboard") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <LayoutDashboard className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
                  <p className="text-sm text-muted-foreground">Logged in as: <span className="font-semibold text-primary">{adminUsername}</span></p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Main Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Approval Card */}
            <Card
              className="cursor-pointer hover:shadow-xl transition-all duration-300 border-2 hover:border-[#00555A] group"
              onClick={() => setCurrentView("approvals")}
            >
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl group-hover:scale-110 transition-transform">
                    <Building2 className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">Approvals</h2>
                    <p className="text-sm text-slate-500">Clinic Registrations</p>
                  </div>
                </div>
                <p className="text-slate-600 mb-4">
                  Review and approve or reject clinic registration requests. Manage new clinic applications and ensure quality standards.
                </p>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  {stats && (
                    <>
                      <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">
                        {stats.pending_registrations} pending
                      </span>
                      <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full">
                        {stats.approved_registrations} approved
                      </span>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Feedback Card */}
            <Card
              className="cursor-pointer hover:shadow-xl transition-all duration-300 border-2 hover:border-[#00555A] group"
              onClick={() => {
                setCurrentView("feedback");
                fetchAllFeedback();
              }}
            >
              <CardContent className="p-8">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-4 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl group-hover:scale-110 transition-transform">
                    <MessageSquare className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">Feedback</h2>
                    <p className="text-sm text-slate-500">User Submissions</p>
                  </div>
                </div>
                <p className="text-slate-600 mb-4">
                  View and manage user feedback submissions. Read what users have to say about their experience with the platform.
                </p>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                    {feedbackList.length} total feedback
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ==================== APPROVALS VIEW ====================
  if (currentView === "approvals") {
    if (loading) {
      return (
        <div className="min-h-screen bg-secondary/30 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading approvals...</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-secondary/30">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentView("dashboard")}
                  className="gap-2"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Back
                </Button>
                <div>
                  <h1 className="text-2xl font-bold text-foreground">Clinic Approvals</h1>
                  <p className="text-sm text-muted-foreground">Manage clinic registration requests</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Pending</p>
                      <p className="text-2xl font-bold text-yellow-600">{stats.pending_registrations}</p>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-full">
                      <Clock className="w-5 h-5 text-yellow-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Approved</p>
                      <p className="text-2xl font-bold text-green-600">{stats.approved_registrations}</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-full">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Rejected</p>
                      <p className="text-2xl font-bold text-red-600">{stats.rejected_registrations}</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-full">
                      <XCircle className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Clinics</p>
                      <p className="text-2xl font-bold text-blue-600">{stats.total_active_clinics}</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-full">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Search and Tabs */}
          <Card>
            <div className="p-6 border-b">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clinics..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-full sm:w-64"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={activeTab === "pending" ? "default" : "outline"}
                    onClick={() => setActiveTab("pending")}
                    size="sm"
                  >
                    Pending
                  </Button>
                  <Button
                    variant={activeTab === "approved" ? "default" : "outline"}
                    onClick={() => setActiveTab("approved")}
                    size="sm"
                  >
                    Approved
                  </Button>
                  <Button
                    variant={activeTab === "rejected" ? "default" : "outline"}
                    onClick={() => setActiveTab("rejected")}
                    size="sm"
                  >
                    Rejected
                  </Button>
                </div>
              </div>
            </div>

            <CardContent className="p-6">
              {filteredRegistrations.length === 0 ? (
                <div className="text-center py-12">
                  <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No registrations found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredRegistrations.map((reg) => (
                    <Card key={reg.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold">{reg.clinic_name}</h3>
                              {getStatusBadge(reg.status || "pending")}
                              {reg.category && (
                                <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full capitalize">
                                  {reg.category.replace(/_/g, " ")}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground mb-3">
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                {reg.email}
                              </div>
                              <div className="flex items-center gap-2">
                                <Phone className="w-4 h-4" />
                                {reg.phone}
                              </div>
                              <div className="flex items-center gap-2 md:col-span-2">
                                <MapPin className="w-4 h-4" />
                                {reg.address}
                              </div>
                              {(reg.doctor_name || reg.specialization) && (
                                <div className="flex items-center gap-2 md:col-span-2">
                                  <User className="w-4 h-4" />
                                  {reg.doctor_name ? `Dr. ${reg.doctor_name}` : "Doctor"}
                                  {reg.specialization && ` - ${reg.specialization}`}
                                </div>
                              )}
                            </div>

                            <p className="text-xs text-muted-foreground">
                              Submitted: {new Date(reg.created_at).toLocaleString()}
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setSelectedReg(reg)}
                            >
                              View Details
                            </Button>
                            {reg.status === "pending" && (
                              <>
                                <Button
                                  variant="default"
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => handleApprove(reg)}
                                  disabled={actionLoading}
                                >
                                  {actionLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                  )}
                                  Approve
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => setSelectedReg(reg)}
                                  disabled={actionLoading}
                                >
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail/Action Dialog */}
        <Dialog open={!!selectedReg} onOpenChange={() => setSelectedReg(null)}>
          <DialogContent className="max-w-2xl">
            {selectedReg && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    {selectedReg.clinic_name}
                  </DialogTitle>
                  <DialogDescription>
                    Registration ID: {selectedReg.clinic_id}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Clinic Name</label>
                      <p className="text-sm font-medium">{selectedReg.clinic_name}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Category</label>
                      <p className="text-sm capitalize">{selectedReg.category?.replace(/_/g, " ") || "Not specified"}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Email</label>
                      <p className="text-sm">{selectedReg.email}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Phone</label>
                      <p className="text-sm">{selectedReg.phone}</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm font-medium text-muted-foreground">Full Address</label>
                      <p className="text-sm">{selectedReg.address}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">City</label>
                      <p className="text-sm">{selectedReg.city}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Pincode</label>
                      <p className="text-sm">{selectedReg.pincode}</p>
                    </div>
                    {(selectedReg.doctor_name || selectedReg.specialization) && (
                      <div className="md:col-span-2 mt-2 pt-2 border-t">
                        <label className="text-sm font-medium text-muted-foreground mb-2 block">Doctor Details</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/50 p-3 rounded-lg">
                          {selectedReg.doctor_name && (
                            <div>
                              <label className="text-xs text-muted-foreground">Doctor Name</label>
                              <p className="text-sm font-medium">Dr. {selectedReg.doctor_name}</p>
                            </div>
                          )}
                          {selectedReg.specialization && (
                            <div>
                              <label className="text-xs text-muted-foreground">Specialization</label>
                              <p className="text-sm">{selectedReg.specialization}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Status</label>
                      <div className="mt-1">{getStatusBadge(selectedReg.status || "pending")}</div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Submitted</label>
                      <p className="text-sm">{new Date(selectedReg.created_at).toLocaleString()}</p>
                    </div>
                  </div>

                  {selectedReg.status === "pending" && (
                    <div className="border-t pt-4">
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        Rejection Reason (optional)
                      </label>
                      <Textarea
                        placeholder="Enter reason for rejection..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="min-h-[80px]"
                      />
                    </div>
                  )}
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setSelectedReg(null)}>
                    Close
                  </Button>
                  {selectedReg.status === "pending" && (
                    <>
                      <Button
                        variant="destructive"
                        onClick={() => handleReject(selectedReg)}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                          <XCircle className="w-4 h-4 mr-1" />
                        )}
                        Reject
                      </Button>
                      <Button
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => handleApprove(selectedReg)}
                        disabled={actionLoading}
                      >
                        {actionLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                          <CheckCircle className="w-4 h-4 mr-1" />
                        )}
                        Approve
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ==================== FEEDBACK VIEW ====================
  if (currentView === "feedback") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header */}
        <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentView("dashboard")}
                  className="gap-2"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Back
                </Button>
                <div>
                  <h1 className="text-xl font-bold text-slate-800">All Feedback</h1>
                  <p className="text-xs text-slate-500">View all user feedback submissions</p>
                </div>
              </div>
              <Button
                variant="outline"
                className="border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg font-medium transition-all"
                onClick={fetchAllFeedback}
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Stats Card */}
          <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-purple-100 p-3 rounded-xl">
                  <MessageSquare className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Total Feedback</h2>
                  <p className="text-sm text-slate-500">All submissions received</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-purple-600">{feedbackList.length}</p>
                <p className="text-xs text-slate-500">submissions</p>
              </div>
            </div>
          </div>

          {/* Feedback List */}
          <div className="space-y-4">
            {feedbackLoading ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <div className="animate-spin h-8 w-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-600">Loading feedback...</p>
              </div>
            ) : feedbackList.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8 text-center">
                <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium mb-2">No feedback found</p>
                <p className="text-sm text-slate-500">No feedback submissions yet</p>
              </div>
            ) : (
              feedbackList.map((feedback) => (
                <div
                  key={feedback.id}
                  className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Feedback Header */}
                  <div className="bg-gradient-to-r from-slate-50 to-white px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-100 p-2 rounded-lg">
                        <MessageSquare className="h-5 w-5 text-slate-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">{feedback.name}</h3>
                        <p className="text-xs text-slate-500">Submitted {formatDate(feedback.created_at)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Feedback Content */}
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{feedback.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-600">{feedback.phone}</span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-slate-700 leading-relaxed">{feedback.message}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </main>
      </div>
    );
  }

  return null;
};

export default AdminDashboard;