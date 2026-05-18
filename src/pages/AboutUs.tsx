import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/config/app";
import {
  ArrowRight,
  Building2,
  CheckCircle,
  Clock,
  Mail,
  Smartphone,
  Users
} from "lucide-react";

const benefits = [
  {
    icon: Clock,
    title: "Save Time",
    description: "Join queues remotely and get live updates before you leave for the clinic."
  },
  {
    icon: Smartphone,
    title: "Mobile First",
    description: "Book appointments, track queue movement, and manage visits from your phone."
  },
  {
    icon: Users,
    title: "For Patients",
    description: "Reduce waiting room stress with clearer queue status and appointment flow."
  },
  {
    icon: Building2,
    title: "For Clinics",
    description: "Organize patient flow, reduce crowding, and keep front-desk work simpler."
  }
];

const steps = [
  {
    title: "Register",
    description: "Sign up as a patient or clinic."
  },
  {
    title: "Book or Join",
    description: "Reserve a time or enter the queue."
  },
  {
    title: "Track",
    description: "Follow queue status and timing updates."
  },
  {
    title: "Visit",
    description: "Arrive closer to the consultation time."
  }
];

const quickLinks = [
  { to: "/patient/signup", label: "Patient Registration" },
  { to: "/clinic/register", label: "Clinic Registration" },
  { to: "/patient/login", label: "Patient Login" },
  { to: "/clinic/login", label: "Clinic Login" }
];

const AboutUs = () => {
  return (
    <main className="min-h-screen bg-background sm:bg-[linear-gradient(180deg,hsl(var(--secondary))_0%,hsl(var(--background))_34%,hsl(var(--background))_100%)]">
      <section className="mx-auto max-w-6xl px-4 py-5 sm:py-10 lg:py-14">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:rounded-2xl sm:border-primary/15 sm:bg-primary sm:shadow-[0_24px_70px_-36px_rgba(18,80,70,0.75)]">
          <div className="grid gap-0 lg:grid-cols-[1.18fr_0.82fr]">
            <div className="p-5 text-foreground sm:p-8 sm:text-primary-foreground lg:p-10">
              <span className="inline-flex rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:border-white/20 sm:bg-white/10 sm:text-white/75">
              About Krama
              </span>
              <h1 className="mt-4 max-w-2xl font-display text-2xl font-bold leading-tight sm:mt-5 sm:text-5xl">
                A calmer clinic visit, from booking to consultation.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-5 sm:text-base sm:text-white/78">
                Krama transforms the healthcare experience by reducing wait times and streamlining patient flow through digital queue management. Quality healthcare starts with a smooth, stress-free journey from home to consultation.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:mt-7 sm:flex-row">
                <Button asChild className="sm:bg-primary-foreground sm:text-primary sm:hover:bg-primary-foreground/90">
                  <Link to="/patient/signup">
                    Patient Registration
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="sm:border-white/25 sm:bg-white/5 sm:text-primary-foreground sm:hover:bg-white/10 sm:hover:text-primary-foreground">
                  <Link to="/clinic/register">Clinic Registration</Link>
                </Button>
              </div>
            </div>

            <div className="border-t border-border bg-secondary/45 p-5 sm:border-white/10 sm:bg-white/[0.07] sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <div className="hidden h-11 w-11 items-center justify-center rounded-lg bg-white/12 text-primary-foreground sm:flex">
                <CheckCircle className="h-5 w-5" />
              </div>
              <h2 className="font-display text-xl font-bold text-foreground sm:mt-5 sm:text-2xl sm:text-primary-foreground">Our Mission</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:mt-3 sm:text-white/75">
                Build a queue experience where patients know when to arrive and clinics can keep movement predictable.
              </p>
              <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-muted-foreground sm:mt-6 sm:space-y-3 sm:border-white/10 sm:pt-5 sm:text-white/78">
                <div className="flex gap-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:text-white" />
                  <span>Clearer appointment and queue status for patients.</span>
                </div>
                <div className="flex gap-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:text-white" />
                  <span>Better front-desk visibility for clinics.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-6 sm:mt-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">Why Choose Krama?</h2>
              <p className="mt-2 text-sm text-muted-foreground">Focused tools for patients and clinics without extra noise.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {benefits.map(({ icon: Icon, title, description }) => (
              <article key={title} className="rounded-xl border border-border/80 bg-card/90 p-4 shadow-sm sm:p-5 sm:shadow-[0_16px_45px_-34px_rgba(18,80,70,0.55)]">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-border bg-card/85 p-4 shadow-sm sm:mt-10 sm:rounded-2xl sm:p-6 sm:shadow-[0_20px_60px_-42px_rgba(18,80,70,0.6)]">
          <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">How It Works</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {steps.map((step, index) => (
              <article key={step.title} className="rounded-xl border border-border bg-background/70 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                  {index + 1}
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 grid gap-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:mt-10 sm:gap-6 sm:rounded-2xl sm:border-primary/15 sm:bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--secondary))_100%)] sm:p-6 sm:shadow-[0_22px_65px_-42px_rgba(18,80,70,0.6)] md:grid-cols-2">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">Get in Touch</h2>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex gap-3">
                <Mail className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Email</p>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary transition hover:text-primary/80">
                    {SUPPORT_EMAIL}
                  </a>
                </div>
              </div>
              <div className="flex gap-3">
                <Clock className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Support Hours</p>
                  <p className="text-muted-foreground">All day. Help from 10 AM to 4 PM.</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-foreground">Quick Links</h3>
            <div className="mt-4 grid gap-2">
              {quickLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center justify-between rounded-lg border border-border bg-card/80 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/35 hover:bg-card hover:text-primary"
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
            <Button asChild className="mt-4 w-full">
              <Link to="/">Back to Home</Link>
            </Button>
          </div>
        </section>
      </section>
    </main>
  );
};

export default AboutUs;
