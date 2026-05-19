import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#00555A]/20 bg-white/95 backdrop-blur-xl shadow-sm">
      <div className="section-container px-4 md:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4 py-2">
          <Link to="/" onClick={closeMenu} className="flex items-center">
            <div>
              <p className="font-display text-2xl font-bold tracking-tight text-[#00555A]">
                <span className="text-3xl">K</span>rama
              </p>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#00555A]/25 text-[#00555A] transition hover:bg-[#00555A]/5 sm:hidden"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <nav className="hidden items-center justify-end gap-1 sm:flex" aria-label="Primary navigation">
            <Link to="/about" className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[#00555A]/5 hover:text-[#00555A]">
              About Us
            </Link>
            <Link to="/feedback" className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[#00555A]/5 hover:text-[#00555A]">
              Feedback
            </Link>
            <Link to="/your-token" className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-[#00555A]/5 hover:text-[#00555A]">
              Your Token
            </Link>
            <Link to="/clinic/login">
              <Button size="sm" variant="outline" className="rounded-full border-[#00555A] text-[#00555A] hover:bg-[#00555A] hover:text-white">
                Clinic Login
              </Button>
            </Link>
            <Link to="/patient/login">
              <Button size="sm" className="rounded-full bg-[#00555A] text-white hover:bg-[#004448]">
                Patient Login
              </Button>
            </Link>
          </nav>
        </div>

        {isMenuOpen && (
          <nav className="grid gap-2 border-t border-[#00555A]/10 py-3 sm:hidden" aria-label="Mobile navigation">
            <Link onClick={closeMenu} to="/about" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-[#00555A]/5 hover:text-[#00555A]">
              About Us
            </Link>
            <Link onClick={closeMenu} to="/feedback" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-[#00555A]/5 hover:text-[#00555A]">
              Feedback
            </Link>
            <Link onClick={closeMenu} to="/your-token" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-[#00555A]/5 hover:text-[#00555A]">
              Your Token
            </Link>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link onClick={closeMenu} to="/clinic/login" className="min-w-0">
                <Button size="sm" variant="outline" className="w-full rounded-full border-[#00555A] px-2 text-xs text-[#00555A] hover:bg-[#00555A] hover:text-white">
                  Clinic Login
                </Button>
              </Link>
              <Link onClick={closeMenu} to="/patient/login" className="min-w-0">
                <Button size="sm" className="w-full rounded-full bg-[#00555A] px-2 text-xs text-white hover:bg-[#004448]">
                  Patient Login
                </Button>
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;
