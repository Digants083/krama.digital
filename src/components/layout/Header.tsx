import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#ffffff26] bg-[#0f2a24]/95 text-white backdrop-blur-xl shadow-[0_12px_40px_-28px_rgba(0,0,0,0.85)]">
      <div className="section-container px-4 md:px-8">
        <div className="flex min-h-16 items-center justify-between gap-4 py-2">
          <Link to="/" onClick={closeMenu} className="flex items-center gap-2">
            <img src="/krama-logo.png" alt="Krama" className="h-9 w-9 rounded-xl shadow-[0_12px_28px_-18px_rgba(246,216,196,0.8)]" />
            <p className="font-display text-2xl font-bold tracking-tight text-white">Krama</p>
          </Link>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 text-white transition hover:bg-white/10 sm:hidden"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <nav className="hidden items-center justify-end gap-1 sm:flex" aria-label="Primary navigation">
            <Link to="/about" className="rounded-full px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white">
              About Us
            </Link>
            <Link to="/feedback" className="rounded-full px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white">
              Feedback
            </Link>
            <Link to="/your-token" className="rounded-full px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white">
              Your Token
            </Link>
            <Link to="/clinic/login">
              <Button size="sm" variant="outline" className="rounded-full border-white/35 bg-white/10 text-white hover:bg-white/20">
                Clinic Login
              </Button>
            </Link>
            <Link to="/patient/login">
              <Button size="sm" className="rounded-full bg-[#f6d8c4] text-[#142620] shadow-[0_12px_28px_-20px_rgba(246,216,196,0.9)] hover:bg-white">
                Patient Login
              </Button>
            </Link>
          </nav>
        </div>

        {isMenuOpen && (
          <nav className="grid gap-2 border-t border-white/15 py-3 sm:hidden" aria-label="Mobile navigation">
            <Link onClick={closeMenu} to="/about" className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
              About Us
            </Link>
            <Link onClick={closeMenu} to="/feedback" className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
              Feedback
            </Link>
            <Link onClick={closeMenu} to="/your-token" className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white">
              Your Token
            </Link>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link onClick={closeMenu} to="/clinic/login" className="min-w-0">
                <Button size="sm" variant="outline" className="w-full rounded-full border-white/35 bg-white/10 px-2 text-xs text-white hover:bg-white/20">
                  Clinic Login
                </Button>
              </Link>
              <Link onClick={closeMenu} to="/patient/login" className="min-w-0">
                <Button size="sm" className="w-full rounded-full bg-[#f6d8c4] px-2 text-xs text-[#142620] hover:bg-white">
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
