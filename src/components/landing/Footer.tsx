const Footer = () => (
  <footer id="contact" className="border-t border-border/70 bg-white/70 px-4 py-6 backdrop-blur md:px-8">
    <div className="section-container flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
      <div>
        <p className="font-display text-2xl font-semibold text-primary">Krama</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Smart queue management connecting patients and clinics for seamless healthcare.
        </p>
      </div>

      <div className="space-y-2 text-sm text-muted-foreground">
        <p>support@krama.in</p>
        <a href="/feedback" className="text-[#00555A] hover:underline font-medium">
          Send Feedback
        </a>
        <p>&copy; {new Date().getFullYear()} Krama. All rights reserved.</p>
      </div>
    </div>
  </footer>
);

export default Footer;
