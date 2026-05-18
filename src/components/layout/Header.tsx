import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Header = () => {
  return (
    <header className="sticky top-0 z-50 border-b border-[#00555A]/20 bg-white/95 backdrop-blur-xl shadow-sm">
      <div className="section-container px-4 md:px-8">
        <div className="flex flex-col gap-3 py-3 sm:min-h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2">
          <Link to="/" className="flex items-center">
            <div>
              <p className="font-display font-bold tracking-tight text-[#00555A] text-2xl">
                <span className="text-3xl">K</span>rama
              </p>
            </div>
          </Link>

          <nav className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-1">
            <Link to="/about" className="px-2 py-2 text-center text-xs font-medium text-slate-600 transition-colors hover:text-[#00555A] sm:px-3 sm:text-sm">
              About Us
            </Link>
            <Link to="/feedback" className="px-2 py-2 text-center text-xs font-medium text-slate-600 transition-colors hover:text-[#00555A] sm:px-3 sm:text-sm">
              Feedback
            </Link>
            <Link to="/your-token" className="px-2 py-2 text-center text-xs font-medium text-slate-600 transition-colors hover:text-[#00555A] sm:px-3 sm:text-sm">
              Your Token
            </Link>
            <Link to="/clinic/login" className="col-span-1">
              <Button size="sm" variant="outline" className="w-full border-[#00555A] px-3 text-xs text-[#00555A] hover:bg-[#00555A] hover:text-white sm:w-auto sm:text-sm">
                Clinic Login
              </Button>
            </Link>
            <Link to="/patient/login" className="col-span-2 sm:col-span-1">
              <Button size="sm" className="w-full bg-[#00555A] px-3 text-xs text-white hover:bg-[#004448] sm:w-auto sm:text-sm">
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
