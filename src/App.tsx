import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";

import MainLayout from "./layouts/MainLayout";
import NoHeaderLayout from "./layouts/NoHeaderLayout";
import { QueueProvider } from "./context/QueueContext";
import { PatientProvider } from "./context/PatientContext";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import SeoManager from "./components/SeoManager";

const Index = lazy(() => import("./pages/Index"));
const PatientDashboard = lazy(() => import("./pages/PatientDashboard"));
const PatientFindClinics = lazy(() => import("./pages/PatientFindClinics"));
const PatientReviews = lazy(() => import("./pages/PatientReviews"));
const PatientWriteReview = lazy(() => import("./pages/PatientWriteReview"));
const PatientProfile = lazy(() => import("./pages/PatientProfile"));
const PatientHealthRecords = lazy(() => import("./pages/PatientHealthRecords"));
const PatientHealthSummary = lazy(() => import("./pages/PatientHealthSummary"));
const ClinicDashboard = lazy(() => import("./pages/ClinicDashboardNew"));
const DoctorDashboard = lazy(() => import("./pages/DoctorDashboard"));
const ConsultationTranscript = lazy(() => import("./pages/ConsultationTranscript"));
const ClinicControlQueue = lazy(() => import("./pages/ClinicControlQueue"));
const ClinicManageTime = lazy(() => import("./pages/ClinicManageTime"));
const ClinicLook = lazy(() => import("./pages/ClinicLook"));
const ClinicProfile = lazy(() => import("./pages/ClinicProfile"));
const ClinicBilling = lazy(() => import("./pages/ClinicBilling"));
const ClinicDetails = lazy(() => import("./pages/ClinicDetails"));
const BookAppointment = lazy(() => import("./pages/BookAppointment"));
const AppointmentConfirmation = lazy(() => import("./pages/AppointmentConfirmation"));
const JoinQueue = lazy(() => import("./pages/JoinQueue"));
const WalkinQueue = lazy(() => import("./pages/WalkinQueue"));
const LiveQueue = lazy(() => import("./pages/LiveQueue"));
const PatientLogin = lazy(() => import("./pages/PatientLogin"));
const PatientSignup = lazy(() => import("./pages/PatientSignup"));
const OTPVerification = lazy(() => import("./pages/OTPVerification"));
const PatientForgotPassword = lazy(() => import("./pages/PatientForgotPassword"));
const PatientVerifyResetOTP = lazy(() => import("./pages/PatientVerifyResetOTP"));
const PatientResetPassword = lazy(() => import("./pages/PatientResetPassword"));
const ClinicLogin = lazy(() => import("./pages/ClinicLogin"));
const ClinicSignup = lazy(() => import("./pages/ClinicSignup"));
const ClinicRegistrationSuccess = lazy(() => import("./pages/ClinicRegistrationSuccess"));
const ClinicPatientReports = lazy(() => import("./pages/ClinicPatientReports"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminFeedbackPage = lazy(() => import("./pages/AdminFeedbackPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const AboutUs = lazy(() => import("./pages/AboutUs"));
const FAQ = lazy(() => import("./pages/FAQ"));
const YourDetails = lazy(() => import("./pages/YourDetails"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SeoLandingPage = lazy(() => import("./pages/SeoLandingPage"));

const PageLoader = () => (
  <div className="min-h-[40vh] flex items-center justify-center bg-background text-foreground">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" aria-label="Loading page" />
  </div>
);

function App() {
  return (
    <QueueProvider>
      <PatientProvider>
        <BrowserRouter>
          <SeoManager />
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes with Header */}
            <Route path="/" element={<MainLayout><Index /></MainLayout>} />
            <Route path="/about" element={<MainLayout><AboutUs /></MainLayout>} />
            <Route path="/faq" element={<MainLayout><FAQ /></MainLayout>} />
            <Route path="/feedback" element={<MainLayout><FeedbackPage /></MainLayout>} />
            <Route path="/find-clinics-near-me" element={<MainLayout><SeoLandingPage page="findClinics" /></MainLayout>} />
            <Route path="/queue-management" element={<MainLayout><SeoLandingPage page="queueManagement" /></MainLayout>} />
            <Route path="/control-queue" element={<MainLayout><SeoLandingPage page="controlQueue" /></MainLayout>} />
            <Route path="/digital-token-system" element={<MainLayout><SeoLandingPage page="digitalToken" /></MainLayout>} />
            <Route path="/manage-queue-in-clinic" element={<MainLayout><SeoLandingPage page="manageClinicQueue" /></MainLayout>} />
            <Route path="/reduce-patient-waiting-time" element={<MainLayout><SeoLandingPage page="reduceWaitingTime" /></MainLayout>} />
            <Route path="/hospital-queue-management" element={<MainLayout><SeoLandingPage page="hospitalQueue" /></MainLayout>} />
            <Route path="/opd-queue-management" element={<MainLayout><SeoLandingPage page="opdQueue" /></MainLayout>} />
            <Route path="/clinic-waiting-room-management" element={<MainLayout><SeoLandingPage page="waitingRoom" /></MainLayout>} />
            <Route path="/qr-code-queue-system" element={<MainLayout><SeoLandingPage page="qrQueue" /></MainLayout>} />
            <Route path="/doctor-appointment-system" element={<MainLayout><SeoLandingPage page="doctorAppointment" /></MainLayout>} />
            <Route path="/walk-in-patient-management" element={<MainLayout><SeoLandingPage page="walkInPatient" /></MainLayout>} />
            <Route path="/your-token" element={<MainLayout><YourDetails /></MainLayout>} />
            <Route path="/your-details" element={<Navigate to="/your-token" replace />} />

            {/* Patient Auth with Header */}
            <Route path="/patient/login" element={<MainLayout><PatientLogin /></MainLayout>} />
            <Route path="/patient/signup" element={<MainLayout><PatientSignup /></MainLayout>} />
            <Route path="/patient/verify-otp" element={<MainLayout><OTPVerification /></MainLayout>} />
            <Route path="/patient/forgot-password" element={<MainLayout><PatientForgotPassword /></MainLayout>} />
            <Route path="/patient/verify-reset-otp" element={<MainLayout><PatientVerifyResetOTP /></MainLayout>} />
            <Route path="/patient/reset-password" element={<MainLayout><PatientResetPassword /></MainLayout>} />

            {/* Clinic Auth with Header */}
            <Route path="/clinic/login" element={<MainLayout><ClinicLogin /></MainLayout>} />

            <Route path="/clinic/register" element={<MainLayout><ClinicSignup /></MainLayout>} />
            <Route path="/clinic/register/success" element={<MainLayout><ClinicRegistrationSuccess /></MainLayout>} />
            <Route path="/clinic/forgot-password" element={<MainLayout><PatientForgotPassword /></MainLayout>} />
            <Route path="/clinic/verify-reset-otp" element={<MainLayout><PatientVerifyResetOTP /></MainLayout>} />
            <Route path="/clinic/reset-password" element={<MainLayout><PatientResetPassword /></MainLayout>} />

            {/* Patient Area without Header */}
            <Route path="/patient" element={<NoHeaderLayout><PatientDashboard /></NoHeaderLayout>} />
            <Route path="/patient/find-clinics" element={<NoHeaderLayout><PatientFindClinics /></NoHeaderLayout>} />
            <Route path="/patient/reviews" element={<NoHeaderLayout><PatientReviews /></NoHeaderLayout>} />
            <Route path="/patient/reviews/:clinicId" element={<NoHeaderLayout><PatientWriteReview /></NoHeaderLayout>} />
            <Route path="/patient/profile" element={<NoHeaderLayout><PatientProfile /></NoHeaderLayout>} />
            <Route path="/patient/health-records" element={<NoHeaderLayout><PatientHealthRecords /></NoHeaderLayout>} />
            <Route path="/patient/health-summary" element={<NoHeaderLayout><PatientHealthSummary /></NoHeaderLayout>} />
            <Route path="/clinic-details/:id" element={<NoHeaderLayout><ClinicDetails /></NoHeaderLayout>} />
            <Route path="/book/:clinicId/:doctorId" element={<NoHeaderLayout><BookAppointment /></NoHeaderLayout>} />
            <Route path="/confirmation" element={<NoHeaderLayout><AppointmentConfirmation /></NoHeaderLayout>} />

            {/* Queue System without Header */}
            <Route path="/join" element={<NoHeaderLayout><JoinQueue /></NoHeaderLayout>} />
            <Route path="/walkin" element={<NoHeaderLayout><WalkinQueue /></NoHeaderLayout>} />
            <Route path="/live" element={<NoHeaderLayout><LiveQueue /></NoHeaderLayout>} />

            {/* Clinic Area without Header */}
            <Route path="/clinic" element={<NoHeaderLayout><ClinicDashboard /></NoHeaderLayout>} />
            <Route path="/clinic/control-queue" element={<NoHeaderLayout><ClinicControlQueue /></NoHeaderLayout>} />
            <Route path="/clinic/manage-time" element={<NoHeaderLayout><ClinicManageTime /></NoHeaderLayout>} />
            <Route path="/clinic/look" element={<NoHeaderLayout><ClinicLook /></NoHeaderLayout>} />
            <Route path="/clinic/billing" element={<NoHeaderLayout><ClinicBilling /></NoHeaderLayout>} />
            <Route path="/clinic/profile" element={<NoHeaderLayout><ClinicProfile /></NoHeaderLayout>} />
            <Route path="/clinic/reports" element={<NoHeaderLayout><ClinicPatientReports /></NoHeaderLayout>} />
            <Route
            path="/doctor-dashboard" element={<NoHeaderLayout><DoctorDashboard /></NoHeaderLayout>} />
            <Route path="/doctor-dashboard/consultation-transcript" element={<NoHeaderLayout><ConsultationTranscript /></NoHeaderLayout>} />

            {/* Admin Area - Secure Routes */}
            <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
            <Route path="/admin/login" element={<NoHeaderLayout><AdminLogin /></NoHeaderLayout>} />
            <Route
              path="/admin/dashboard"
              element={
                <NoHeaderLayout>
                  <AdminProtectedRoute>
                    <AdminDashboard />
                  </AdminProtectedRoute>
                </NoHeaderLayout>
              }
            />
            <Route
              path="/admin/feedback"
              element={
                <NoHeaderLayout>
                  <AdminProtectedRoute>
                    <AdminFeedbackPage />
                  </AdminProtectedRoute>
                </NoHeaderLayout>
              }
            />

            {/* 404 with Header */}
            <Route path="*" element={<MainLayout><NotFound /></MainLayout>} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </PatientProvider>
    </QueueProvider>
  );
}

export default App;
