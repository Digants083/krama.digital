import { APP_NAME, SUPPORT_EMAIL } from "@/config/app";
import { Link } from "react-router-dom";

const Footer = () => (
  <footer id="contact" className="border-t border-border/70 bg-white/70 px-4 py-6 backdrop-blur md:px-8">
    <div className="section-container flex flex-col gap-6 text-center md:flex-row md:items-start md:justify-between md:text-left">
      <div>
        <p className="font-display text-2xl font-semibold text-primary">{APP_NAME}</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Smart queue management connecting patients and clinics for seamless healthcare.
        </p>
      </div>

      <nav className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 md:text-left" aria-label="SEO pages">
        <Link to="/find-clinics-near-me" className="text-[#00555A] hover:underline">
          Find Clinics Near Me
        </Link>
        <Link to="/faq" className="text-[#00555A] hover:underline">
          FAQ
        </Link>
        <Link to="/queue-management" className="text-[#00555A] hover:underline">
          Queue Management
        </Link>
        <Link to="/control-queue" className="text-[#00555A] hover:underline">
          Control Queue
        </Link>
        <Link to="/digital-token-system" className="text-[#00555A] hover:underline">
          Digital Token System
        </Link>
        <Link to="/manage-queue-in-clinic" className="text-[#00555A] hover:underline">
          Manage Clinic Queue
        </Link>
        <Link to="/reduce-patient-waiting-time" className="text-[#00555A] hover:underline">
          Reduce Waiting Time
        </Link>
        <Link to="/opd-queue-management" className="text-[#00555A] hover:underline">
          OPD Queue Management
        </Link>
        <Link to="/qr-code-queue-system" className="text-[#00555A] hover:underline">
          QR Queue System
        </Link>
      </nav>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{SUPPORT_EMAIL}</p>
        <Link to="/feedback" className="text-[#00555A] hover:underline font-medium">
          Send Feedback
        </Link>
        <p>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
      </div>
    </div>
  </footer>
);

export default Footer;
