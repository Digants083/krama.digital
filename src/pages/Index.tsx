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
  { value: "10+", label: "Clinics onboarding" },
  { value: "500+", label: "Expected patients" },
  { value: "18m", label: "Average visible wait" },
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
    <div className="min-h-screen overflow-hidden bg-[#fbfaf7]">
      <section className="section-container px-4 pb-14 pt-10 md:px-8 md:pb-24 md:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.04fr_0.96fr] lg:gap-16">
            <div className="text-foreground">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e6ded3] bg-white px-4 py-2 text-sm text-[#40514b] shadow-sm">
                <Sparkles className="h-4 w-4 text-accent" />
                Minimal clinic queueing for patients
              </div>

              <h1 className="mt-7 max-w-3xl font-display text-5xl font-bold leading-[1.08] tracking-tight text-[#142620] sm:text-6xl lg:text-7xl">
                Make clinic visits feel calm, clear, and on time.
              </h1>

              <p className="mt-7 max-w-2xl text-xl leading-8 text-[#40514b]">
                Krama keeps your existing flow intact while giving the website a cleaner face for patients and clinics. Join digitally, track turns live, and reduce crowded waiting rooms.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#1f6657] px-8 text-sm font-semibold text-white shadow-[0_18px_35px_-22px_rgba(31,102,87,0.9)] hover:bg-[#185449]">
                  <Link to="/patient/login">
                    Patient Login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-[#e0d7ca] bg-white px-8 text-sm font-semibold text-[#142620] hover:bg-[#f3efe8]"
                >
                  <Link to="/clinic/login">Clinic Login</Link>
                </Button>
              </div>

              <div className="mt-10 grid max-w-2xl grid-cols-3 gap-4">
                {heroStats.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[#e6ded3] bg-white p-5 shadow-sm">
                    <p className="font-display text-3xl font-bold text-[#1f6657]">{item.value}</p>
                    <p className="mt-2 text-sm leading-tight text-[#60736d]">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-auto w-full max-w-[532px]">
              <div className="rounded-[32px] bg-white p-8 shadow-[0_32px_90px_-58px_rgba(28,38,34,0.8)]">
                <div className="flex items-center justify-between rounded-[32px] border border-[#e6ded3] bg-[#fbfaf7] px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#60736d]">Live queue</p>
                    <p className="mt-2 text-lg font-bold text-[#142620]">CityCare Clinic</p>
                  </div>
                  <div className="rounded-full bg-[#dfe9e4] px-4 py-2 text-sm font-semibold text-[#1f6657]">Active</div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[1fr_0.88fr]">
                  <div className="rounded-[28px] bg-[#1f6657] px-6 py-8 text-white">
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-white/72">Your token</p>
                    <p className="mt-4 font-display text-6xl font-bold">A-17</p>

                    <div className="mt-9 grid grid-cols-2 gap-3">
                      <div className="rounded-[22px] bg-white/14 p-4">
                        <p className="text-xs font-medium text-white/70">Now serving</p>
                        <p className="mt-5 text-2xl font-bold">A-12</p>
                      </div>
                      <div className="rounded-[22px] bg-white/14 p-4">
                        <p className="text-xs font-medium text-white/70">Estimated wait</p>
                        <p className="mt-5 text-2xl font-bold">18 min</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {[
                      { icon: CalendarClock, label: "Booked digitally", value: "Today, 10:30 AM" },
                      { icon: Bell, label: "Arrival reminder", value: "Notify 10 minutes before" },
                      { icon: ShieldCheck, label: "Less crowding", value: "Arrive only when needed" },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="rounded-[22px] border border-[#e6ded3] bg-white p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                          <div className="rounded-2xl bg-[#f3efe8] p-3">
                            <Icon className="h-5 w-5 text-[#1f6657]" />
                          </div>
                          <div>
                            <p className="text-sm text-[#60736d]">{label}</p>
                            <p className="mt-1 text-base font-medium text-[#142620]">{value}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 rounded-[20px] border border-dashed border-[#e0d7ca] bg-[#fbfaf7] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="shrink-0 rounded-full bg-[#f6d8c4] px-4 py-2 text-sm font-medium text-[#142620]">
                        5 patients ahead
                      </div>
                      <p className="min-w-0 text-sm text-[#60736d]">Track every update without calling reception.</p>
                    </div>
                    <BarChart3 className="h-5 w-5 shrink-0 text-[#1f6657]" />
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
