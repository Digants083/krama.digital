import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  Clock,
  Layers3,
  MapPin,
  Search,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Ticket,
  TicketCheck,
  UserCheck,
  Users,
} from "lucide-react";

const heroStats = [
  { value: "Live", label: "Queue movement" },
  { value: "1 tap", label: "Digital token" },
  { value: "18m", label: "Sample visible wait" },
];

const patientFeatures = [
  { icon: MapPin, text: "Find nearby clinics with a simple search flow." },
  { icon: Ticket, text: "Take a digital token before you arrive." },
  { icon: BarChart3, text: "Track position in real time from your phone." },
  { icon: Clock, text: "Reach the clinic close to your actual turn." },
];

const clinicFeatures = [
  { icon: Users, text: "Handle walk-ins and scheduled patients from one flow." },
  { icon: UserCheck, text: "Manage doctor-wise queues with less confusion." },
  { icon: SkipForward, text: "Move to next, skip, and update status quickly." },
  { icon: Activity, text: "Reduce crowding while giving patients live visibility." },
];

const steps = [
  { icon: Search, title: "Search clinics", desc: "Find nearby clinics using your location." },
  { icon: TicketCheck, title: "Get token", desc: "Join the queue digitally in seconds." },
  { icon: BarChart3, title: "Track live", desc: "See updates and estimated wait in real time." },
  { icon: Bell, title: "Arrive on time", desc: "Come in when your turn is close." },
];

const solutionGroups = [
  {
    title: "Clinic operations",
    terms: [
      "clinic management software",
      "clinic management system",
      "clinic administration software",
      "clinic automation software",
      "smart clinic software",
      "software for clinics",
      "software for small clinics",
      "clinic workflow automation",
    ],
  },
  {
    title: "Appointments and patients",
    terms: [
      "doctor appointment software",
      "appointment booking system",
      "online doctor appointment system",
      "doctor scheduling software",
      "clinic appointment management",
      "patient management software",
      "patient registration software",
      "doctor patient management system",
    ],
  },
  {
    title: "Queues and OPD",
    terms: [
      "queue management system for clinics",
      "patient queue management software",
      "clinic token system",
      "hospital queue management system",
      "OPD management software",
      "outpatient management system",
      "reception management software for clinics",
      "doctor dashboard software",
    ],
  },
  {
    title: "Healthcare software",
    terms: [
      "healthcare management software",
      "digital healthcare platform",
      "medical practice management software",
      "medical office software",
      "clinic software India",
      "clinic software Bangalore",
      "best clinic software in India",
      "cloud based clinic management software",
    ],
  },
  {
    title: "Admin and records",
    terms: [
      "medical records management system",
      "electronic medical records software",
      "EMR software",
      "EHR software",
      "digital prescription software",
      "prescription management system",
      "medical billing software",
      "clinic CRM software",
    ],
  },
];

const Index = () => {
  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,hsl(var(--secondary))_0%,hsl(var(--background))_28%,hsl(var(--background))_100%)]">
      <section className="section-container px-4 pb-10 pt-5 md:px-8 md:pb-20 md:pt-14">
        <div className="overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--secondary))_100%)] shadow-[0_28px_80px_-48px_rgba(90,70,42,0.55)]">
          <div className="grid lg:grid-cols-[1.02fr_0.98fr]">
            <div className="p-4 text-foreground sm:p-8 lg:p-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm sm:px-4 sm:py-2 sm:text-sm">
                <Sparkles className="h-4 w-4 text-accent" />
                Digital queue management for clinics
              </div>

              <h1 className="mt-4 max-w-3xl font-display text-3xl font-bold leading-tight sm:mt-6 sm:text-5xl lg:text-6xl">
                Stop waiting rooms from becoming waiting problems.
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-5 md:text-lg">
                Krama lets patients book, join, and track their turn while clinics manage live queues, doctors, and walk-ins from one clean flow.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-8 sm:flex sm:gap-3">
                <Button asChild size="lg" className="h-10 px-3 text-xs sm:h-11 sm:px-6 sm:text-sm">
                  <Link to="/patient/login">
                    Patient Login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-10 px-3 text-xs sm:h-11 sm:px-6 sm:text-sm"
                >
                  <Link to="/clinic/login">Clinic Login</Link>
                </Button>
              </div>

              <div className="mt-5 grid max-w-2xl grid-cols-3 gap-2 sm:mt-10 sm:gap-3">
                {heroStats.map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-card/75 p-2.5 shadow-sm sm:p-4">
                    <p className="font-display text-lg font-bold text-primary sm:text-2xl">{item.value}</p>
                    <p className="mt-1 text-[10px] leading-tight text-muted-foreground sm:text-xs">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/70 bg-background/45 p-3 sm:p-5 lg:border-l lg:border-t-0 lg:p-8">
              <div className="rounded-xl border border-border bg-card/95 p-3 shadow-[0_24px_70px_-44px_rgba(70,54,34,0.5)] sm:rounded-2xl sm:p-5">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background/80 px-3 py-2.5 sm:px-4 sm:py-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">Live queue</p>
                    <p className="mt-1 text-sm font-semibold text-foreground sm:text-lg">CityCare Clinic</p>
                  </div>
                  <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary sm:px-3 sm:text-sm">Active</div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_0.88fr] lg:mt-4 lg:gap-4">
                  <div className="rounded-xl border border-primary/15 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08)_0%,hsl(var(--secondary))_100%)] px-4 py-5 text-foreground sm:px-5 sm:py-7">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">Your token</p>
                    <p className="mt-2 font-display text-4xl font-bold text-primary sm:mt-3 sm:text-6xl">A-17</p>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-7 sm:gap-3">
                      <div className="rounded-lg border border-border bg-card/75 p-3 sm:p-4">
                        <p className="text-[10px] text-muted-foreground sm:text-xs">Now serving</p>
                        <p className="mt-1 text-lg font-semibold text-foreground sm:mt-2 sm:text-2xl">A-12</p>
                      </div>
                      <div className="rounded-lg border border-border bg-card/75 p-3 sm:p-4">
                        <p className="text-[10px] text-muted-foreground sm:text-xs">Estimated wait</p>
                        <p className="mt-1 text-lg font-semibold text-foreground sm:mt-2 sm:text-2xl">18 min</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:gap-3 md:block md:space-y-3">
                    {[
                      { icon: CalendarClock, label: "Booked digitally", value: "Today, 10:30 AM" },
                      { icon: Bell, label: "Arrival reminder", value: "Notify 10 minutes before" },
                      { icon: ShieldCheck, label: "Less crowding", value: "Arrive only when needed" },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-lg border border-border bg-background/75 p-3 sm:p-4">
                        <div className="flex items-start gap-2.5 sm:gap-3">
                          <div className="rounded-lg bg-secondary p-2.5 sm:p-3">
                            <Icon className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>
                            <p className="mt-1 text-sm font-medium text-foreground sm:text-base">{value}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-dashed border-primary/25 bg-primary/5 p-3 sm:mt-4 sm:p-4">
                  <div className="flex items-center justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <div className="shrink-0 rounded-full bg-accent/18 px-2.5 py-1 text-xs font-medium text-foreground sm:px-3 sm:text-sm">
                        5 patients ahead
                      </div>
                      <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">Track updates without calling reception.</p>
                    </div>
                    <BarChart3 className="h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-container px-4 py-12 md:px-8 md:py-16">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-[0_20px_60px_-42px_rgba(18,80,70,0.6)] sm:p-8">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-secondary p-3">
                <Ticket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">For patients</p>
                <h2 className="mt-1 font-display text-3xl font-bold">Know when to leave, not when to wait.</h2>
              </div>
            </div>

            <div className="mt-7 space-y-5">
              {patientFeatures.map((feature) => (
                <Feature key={feature.text} icon={feature.icon} text={feature.text} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card/90 p-6 shadow-[0_20px_60px_-42px_rgba(90,70,42,0.52)] sm:p-8">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-accent/15 p-3">
                <Layers3 className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">For clinics</p>
                <h2 className="mt-1 font-display text-3xl font-bold text-foreground">Keep the queue moving without changing your system.</h2>
              </div>
            </div>

            <div className="mt-7 space-y-5">
              {clinicFeatures.map((feature) => (
                <Feature key={feature.text} accent icon={feature.icon} text={feature.text} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-secondary/45 py-14 md:py-18">
        <div className="section-container px-4 md:px-8">
          <div className="rounded-2xl border border-border bg-card/85 p-6 text-center shadow-[0_20px_60px_-44px_rgba(18,80,70,0.58)] md:p-10">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it works</p>
            <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">A simpler visit in four small steps.</h2>

            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {steps.map((step) => (
                <Step key={step.title} icon={step.icon} title={step.title} desc={step.desc} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-container px-4 py-16 md:px-8 md:py-20">
        <div className="rounded-[36px] bg-foreground px-8 py-12 text-center text-white shadow-[0_28px_80px_-40px_rgba(10,30,26,0.9)] md:px-12">
          <p className="text-sm uppercase tracking-[0.3em] text-white/55">Ready to use Krama?</p>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight md:text-4xl">
            Keep your same workflow and give the product a cleaner first impression.
          </h2>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/patient/login">
              <Button size="lg" variant="secondary">
                Patient Login
              </Button>
            </Link>
            <Link to="/clinic/login">
              <Button
                size="lg"
                variant="outline"
                className="border-white/25 bg-white/5 text-white hover:bg-white/10"
              >
                Clinic Login
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-white/60 py-16 md:py-20">
        <div className="section-container px-4 md:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Clinic software platform</p>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight text-foreground md:text-4xl">
              Built for appointment booking, patient queues, and everyday clinic management.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
              Krama focuses on the daily jobs clinics search for most: clinic management software, doctor appointment
              scheduling, patient registration, OPD queue management, digital token systems, and live reception workflows
              for clinics in India. It is strongest for appointment and queue operations, and can sit alongside EMR, EHR,
              billing, inventory, or prescription tools as clinics expand their digital setup.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
            {solutionGroups.map((group) => (
              <article key={group.title} className="rounded-[24px] border border-border/70 bg-background/80 p-5 shadow-sm">
                <h3 className="font-semibold text-foreground">{group.title}</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {group.terms.map((term) => (
                    <span key={term} className="rounded-full bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
                      {term}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-container px-4 pb-16 md:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Get started</p>
            <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">
              Choose the side of Krama you need today.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Clinics can register their setup. Patients can create an account and start booking appointments.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <StartCard
              label="For clinics"
              title="Register your clinic"
              description="Create your clinic profile, add doctors, set time slots, and start serving."
              to="/clinic/register"
              button="Clinic Registration"
            />
            <StartCard
              label="For patients"
              title="Create your account"
              description="Sign up once, book appointments, and track your queue live."
              to="/patient/signup"
              button="Patient Signup"
              outline
            />
          </div>
        </div>
      </section>
    </div>
  );
};

const Feature = ({
  icon: Icon,
  text,
  dark = false,
  accent = false,
}: {
  icon: LucideIcon;
  text: string;
  dark?: boolean;
  accent?: boolean;
}) => (
  <div className="flex items-start gap-4">
    <div className={`mt-1 rounded-lg p-2.5 ${dark ? "bg-white/10" : accent ? "bg-accent/15" : "bg-secondary"}`}>
      <Icon className={dark ? "text-white" : accent ? "text-accent" : "text-primary"} size={18} />
    </div>
    <p className={dark ? "text-white/80" : "text-muted-foreground"}>{text}</p>
  </div>
);

const Step = ({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) => (
  <div className="rounded-xl border border-border bg-background/75 p-5">
    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
      <Icon className="text-primary" size={21} />
    </div>
    <p className="mt-4 font-semibold text-foreground">{title}</p>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>
  </div>
);

const StartCard = ({
  label,
  title,
  description,
  to,
  button,
  outline = false,
}: {
  label: string;
  title: string;
  description: string;
  to: string;
  button: string;
  outline?: boolean;
}) => (
  <div className="rounded-xl border border-border bg-card/80 p-5">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <h3 className="mt-3 font-display text-2xl font-bold text-foreground">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    <Button asChild className="mt-6 w-full" variant={outline ? "outline" : "default"}>
      <Link to={to}>{button}</Link>
    </Button>
  </div>
);

export default Index;
