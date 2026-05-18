import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import MainLayout from "./layouts/MainLayout";
import NoHeaderLayout from "./layouts/NoHeaderLayout";
import { QueueProvider } from "./context/QueueContext";
import { PatientProvider } from "./context/PatientContext";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import SeoManager from "./components/SeoManager";

import Index from "./pages/Index";
import PatientDashboard from "./pages/PatientDashboard";
import PatientFindClinics from "./pages/PatientFindClinics";
import PatientReviews from "./pages/PatientReviews";
import PatientWriteReview from "./pages/PatientWriteReview";
import PatientProfile from "./pages/PatientProfile";
import ClinicDashboard from "./pages/ClinicDashboardNew";
import DoctorDashboard from "./pages/DoctorDashboard";
import ClinicControlQueue from "./pages/ClinicControlQueue";
import ClinicManageTime from "./pages/ClinicManageTime";
import ClinicLook from "./pages/ClinicLook";
import ClinicProfile from "./pages/ClinicProfile";
import ClinicDetails from "./pages/ClinicDetails";
import BookAppointment from "./pages/BookAppointment";
import AppointmentConfirmation from "./pages/AppointmentConfirmation";
import JoinQueue from "./pages/JoinQueue";
import WalkinQueue from "./pages/WalkinQueue";
import LiveQueue from "./pages/LiveQueue";
import PatientLogin from "./pages/PatientLogin";
import PatientSignup from "./pages/PatientSignup";
import OTPVerification from "./pages/OTPVerification";
import PatientForgotPassword from "./pages/PatientForgotPassword";
import PatientVerifyResetOTP from "./pages/PatientVerifyResetOTP";
import PatientResetPassword from "./pages/PatientResetPassword";
import ClinicLogin from "./pages/ClinicLogin";
import ClinicSignup from "./pages/ClinicSignup";
import ClinicRegistrationSuccess from "./pages/ClinicRegistrationSuccess";
import ClinicPatientReports from "./pages/ClinicPatientReports";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminFeedbackPage from "./pages/AdminFeedbackPage";
import FeedbackPage from "./pages/FeedbackPage";
import AboutUs from "./pages/AboutUs";
import FAQ from "./pages/FAQ";
import YourDetails from "./pages/YourDetails";
import NotFound from "./pages/NotFound";
import SeoLandingPage from "./pages/SeoLandingPage";

function App() {
  return (
    <QueueProvider>
      <PatientProvider>
        <BrowserRouter>
          <SeoManager />
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
            <Route path="/clinic/profile" element={<NoHeaderLayout><ClinicProfile /></NoHeaderLayout>} />
            <Route path="/clinic/reports" element={<NoHeaderLayout><ClinicPatientReports /></NoHeaderLayout>} />
            <Route
            path="/doctor-dashboard" element={<NoHeaderLayout><DoctorDashboard /></NoHeaderLayout>} />

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
        </BrowserRouter>
      </PatientProvider>
    </QueueProvider>
  );
}

export default App;
