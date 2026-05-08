import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Header = () => {
  return (
    <header className="sticky top-0 z-50 border-b border-[#00555A]/20 bg-white/95 backdrop-blur-xl shadow-sm">
      <div className="section-container px-4 md:px-8">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-4 py-2">
          <Link to="/" className="flex items-center">
            <div>
              <p className="font-display font-bold tracking-tight text-[#00555A] text-2xl">
                <span className="text-3xl">K</span>rama
              </p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center justify-end gap-1">
            <Link to="/about" className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-[#00555A] transition-colors">
              About Us
            </Link>
            <Link to="/feedback" className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-[#00555A] transition-colors">
              Feedback
            </Link>
            <Link to="/your-details" className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-[#00555A] transition-colors">
              Your Details
            </Link>
            <Link to="/clinic/login">
              <Button size="sm" variant="outline" className="border-[#00555A] text-[#00555A] hover:bg-[#00555A] hover:text-white">
                Clinic Login
              </Button>
            </Link>
            <Link to="/patient/login">
              <Button size="sm" className="bg-[#00555A] hover:bg-[#004448] text-white">
                Patient Login
              </Button>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
