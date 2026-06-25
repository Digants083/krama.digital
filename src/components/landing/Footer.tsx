import { APP_NAME, SUPPORT_EMAIL } from "@/config/app";
import { Link, useLocation } from "react-router-dom";

const Footer = () => {
  const { pathname } = useLocation();
  const showSeoLinks = pathname !== "/";

  return (
    <footer id="contact" className="border-t border-[#ffffff26] bg-[#0f2a24] px-4 py-10 text-white md:px-8">
      <div className="section-container flex flex-col gap-8 text-center md:flex-row md:items-start md:justify-between md:text-left">
        <div>
          <p className="font-display text-2xl font-semibold text-white">{APP_NAME}</p>
          <p className="mt-2 max-w-sm text-sm text-white/70">
            Smart queue management connecting patients and clinics for seamless healthcare.
          </p>
        </div>

        {showSeoLinks && (
          <nav className="grid gap-2 text-sm text-white/75 sm:grid-cols-2 md:text-left" aria-label="Related pages">
            <Link to="/find-clinics-near-me" className="text-[#f6d8c4] hover:text-white hover:underline">
              Find Clinics Near Me
            </Link>
            <Link to="/faq" className="text-[#f6d8c4] hover:text-white hover:underline">
              FAQ
            </Link>
            <Link to="/queue-management" className="text-[#f6d8c4] hover:text-white hover:underline">
              Queue Management
            </Link>
            <Link to="/control-queue" className="text-[#f6d8c4] hover:text-white hover:underline">
              Control Queue
            </Link>
            <Link to="/digital-token-system" className="text-[#f6d8c4] hover:text-white hover:underline">
              Digital Token System
            </Link>
            <Link to="/manage-queue-in-clinic" className="text-[#f6d8c4] hover:text-white hover:underline">
              Manage Clinic Queue
            </Link>
            <Link to="/reduce-patient-waiting-time" className="text-[#f6d8c4] hover:text-white hover:underline">
              Reduce Waiting Time
            </Link>
            <Link to="/opd-queue-management" className="text-[#f6d8c4] hover:text-white hover:underline">
              OPD Queue Management
            </Link>
            <Link to="/qr-code-queue-system" className="text-[#f6d8c4] hover:text-white hover:underline">
              QR Queue System
            </Link>
          </nav>
        )}

        <div className="space-y-2 text-sm text-white/70">
          <p>{SUPPORT_EMAIL}</p>
          <Link to="/feedback" className="font-medium text-[#f6d8c4] hover:text-white hover:underline">
            Send Feedback
          </Link>
          <p>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
