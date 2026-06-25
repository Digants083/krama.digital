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

const queuePath = [
  { side: "patient", icon: MapPin, title: "Patient finds clinic", text: "Find nearby clinics with a simple search flow." },
  { side: "clinic", icon: Users, title: "Clinic receives entry", text: "Handle walk-ins and scheduled patients from one flow." },
  { side: "patient", icon: Ticket, title: "Patient gets digital token", text: "Take a digital token before you arrive." },
  { side: "clinic", icon: UserCheck, title: "Staff organizes queues", text: "Manage doctor-wise queues with less confusion." },
  { side: "patient", icon: BarChart3, title: "Patient tracks live updates", text: "Track position in real time from your phone." },
  { side: "clinic", icon: SkipForward, title: "Queue moves smoothly", text: "Move to next, skip, and update status quickly." },
  { side: "patient", icon: Clock, title: "Patient arrives on time", text: "Reach the clinic close to your actual turn." },
  { side: "clinic", icon: Activity, title: "Crowding stays lower", text: "Reduce crowding while giving patients live visibility." },
];

const steps = [
  { icon: Search, title: "Search clinics", desc: "Find nearby clinics using your location." },
  { icon: TicketCheck, title: "Get token", desc: "Join the queue digitally in seconds." },
  { icon: BarChart3, title: "Track live", desc: "See updates and estimated wait in real time." },
  { icon: Bell, title: "Arrive on time", desc: "Come in when your turn is close." },
];

const primaryCtaClass =
  "h-12 rounded-full bg-[#f6d8c4] px-8 text-sm font-bold text-[#142620] shadow-[0_22px_50px_-28px_rgba(246,216,196,0.8)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white";
const secondaryCtaClass =
  "h-12 rounded-full border-white/28 bg-white/10 px-8 text-sm font-semibold text-white backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/18 hover:text-white";

const Index = () => {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f3eb]">
      <section className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden bg-[#10251f] text-white">
        <img
          src="/krama-hero-clinic.png"
          alt="Patients using phones in a modern clinic waiting area"
          className="absolute inset-0 h-full w-full object-cover opacity-95 animate-hero-kenburns"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,35,29,0.92)_0%,rgba(12,35,29,0.74)_38%,rgba(12,35,29,0.34)_72%,rgba(12,35,29,0.58)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,35,29,0.18)_0%,rgba(12,35,29,0.22)_52%,rgba(12,35,29,0.88)_100%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.22)_1px,transparent_1px)] [background-size:72px_72px]" />

        <div className="section-container relative flex min-h-[calc(100svh-4rem)] flex-col justify-between px-4 py-10 md:px-8 md:py-12">
          <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[0.88fr_1.12fr] lg:py-14">
            <div className="max-w-4xl animate-hero-copy-rise">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/24 bg-white/12 px-4 py-2 text-sm font-medium text-white shadow-[0_18px_50px_-32px_rgba(0,0,0,0.9)] backdrop-blur-xl">
                <Sparkles className="h-4 w-4 text-[#f6d8c4]" />
                Live queues. Fewer waiting-room guesses.
              </div>

              <h1 className="mt-7 max-w-4xl font-display text-5xl font-bold leading-[0.98] text-white sm:text-6xl lg:text-7xl xl:text-8xl">
                A clinic visit that moves with you.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-white/82 sm:text-xl">
                Krama turns tokens, appointment slots, and live queue updates into one calm flow, so patients arrive closer to their turn and clinics keep the day moving.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className={primaryCtaClass}>
                  <Link to="/patient/login">
                    Patient Login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={secondaryCtaClass}
                >
                  <Link to="/clinic/login">Clinic Login</Link>
                </Button>
              </div>

              <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
                {heroStats.map((item) => (
                  <div key={item.label} className="border-l border-white/22 pl-4">
                    <p className="font-display text-3xl font-bold text-[#f6d8c4]">{item.value}</p>
                    <p className="mt-1 text-sm leading-tight text-white/68">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <HeroCommandDeck />
          </div>

        </div>
      </section>

      <section className="section-container px-4 py-16 md:px-8 md:py-20">
        <div className="relative overflow-hidden rounded-[30px] border border-border/80 bg-card/85 p-6 shadow-[0_24px_70px_-46px_rgba(18,80,70,0.6)] md:p-10">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your queue path</p>
            <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">One clear path for patients and clinics.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              Krama connects both sides in one moving flow, from discovery to arrival.
            </p>
          </div>

          <div className="relative mt-10">
            <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-[420px] -translate-x-1/2 md:block">
              <svg viewBox="0 0 420 980" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                <path
                  d="M210 0 C 292 62, 292 182, 210 245 C 128 308, 128 428, 210 490 C 292 552, 292 672, 210 735 C 128 798, 128 918, 210 980"
                  className="fill-none stroke-[#e6d5bf] stroke-[16]"
                  strokeLinecap="round"
                />
                <path
                  d="M210 0 C 292 62, 292 182, 210 245 C 128 308, 128 428, 210 490 C 292 552, 292 672, 210 735 C 128 798, 128 918, 210 980"
                  className="fill-none stroke-primary/35 stroke-[5]"
                  strokeLinecap="round"
                />
                <path
                  d="M210 0 C 292 62, 292 182, 210 245 C 128 308, 128 428, 210 490 C 292 552, 292 672, 210 735 C 128 798, 128 918, 210 980"
                  className="animate-path-draw fill-none stroke-primary/80 stroke-[2.5]"
                  strokeDasharray="8 16"
                  strokeLinecap="round"
                />
                <circle r="7" className="fill-accent animate-path-pulse">
                  <animateMotion dur="8s" repeatCount="indefinite" rotate="auto">
                    <mpath href="#journey-path-guide" />
                  </animateMotion>
                </circle>
                <defs>
                  <path
                    id="journey-path-guide"
                    d="M210 0 C 292 62, 292 182, 210 245 C 128 308, 128 428, 210 490 C 292 552, 292 672, 210 735 C 128 798, 128 918, 210 980"
                  />
                </defs>
              </svg>
            </div>
            <div className="space-y-5 md:space-y-6">
              {queuePath.map((item, index) => (
                <PathStep key={item.title} {...item} index={index} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-secondary/45 py-16 md:py-20">
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

      <section className="section-container px-4 py-16 md:px-8 md:py-22">
        <div className="relative overflow-hidden rounded-[36px] bg-foreground px-8 py-12 text-center text-white shadow-[0_28px_80px_-40px_rgba(10,30,26,0.9)] md:px-12">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f6d8c4]/55 to-transparent" />
          <p className="relative text-sm uppercase tracking-[0.3em] text-white/55">Ready to use Krama?</p>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight md:text-4xl">
            Keep your same workflow and give the product a cleaner first impression.
          </h2>

          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/patient/login">
              <Button size="lg" className={primaryCtaClass}>
                Patient Login
              </Button>
            </Link>
            <Link to="/clinic/login">
              <Button
                size="lg"
                variant="outline"
                className={secondaryCtaClass}
              >
                Clinic Login
              </Button>
            </Link>
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

const HeroCommandDeck = () => {
  const queueCards = [
    { icon: CalendarClock, label: "Booked digitally", value: "Today, 10:30 AM" },
    { icon: Bell, label: "Arrival reminder", value: "10 min before turn" },
    { icon: ShieldCheck, label: "Less crowding", value: "Arrive only when needed" },
  ];

  return (
    <div className="relative mx-auto min-h-[560px] w-full max-w-[620px] lg:max-w-none">
      <div className="absolute left-1/2 top-1/2 h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12" />
      <div className="absolute left-1/2 top-1/2 h-[48%] w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 animate-hero-orbit" />

      <div className="absolute left-4 right-4 top-5 z-20 rounded-[28px] border border-white/18 bg-white/12 p-4 shadow-[0_28px_90px_-45px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-panel-drift sm:left-auto sm:right-8 sm:w-[340px]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/58">Your token</p>
            <p className="mt-2 font-display text-6xl font-bold text-white">A-17</p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f6d8c4] text-[#142620] shadow-[0_18px_36px_-24px_rgba(246,216,196,0.9)]">
            <TicketCheck className="h-6 w-6" />
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-full bg-white/18">
          <div className="h-2 rounded-full bg-[#f0834c] animate-progress-grow" />
        </div>
        <div className="mt-3 flex justify-between text-xs font-medium text-white/64">
          <span>Now A-12</span>
          <span>18 min</span>
        </div>
      </div>

      <div className="absolute bottom-8 left-4 right-4 z-10 rounded-[30px] border border-white/18 bg-[#fbfaf7]/90 p-4 text-[#142620] shadow-[0_28px_90px_-46px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-panel-rise sm:bottom-6 sm:left-0 sm:right-auto sm:w-[400px]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#60736d]">Queue movement</p>
            <p className="mt-2 text-xl font-bold">5 patients ahead</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[#dfe9e4] px-4 py-2 text-sm font-semibold text-[#1f6657]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-soft-ping rounded-full bg-[#1f6657] opacity-45" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1f6657]" />
            </span>
            Live
          </div>
        </div>

        <div className="mt-5 grid gap-2">
          {queueCards.map(({ icon: Icon, label, value }, index) => (
            <div
              key={label}
              className="animate-ticket-slide flex min-w-0 items-center gap-3 rounded-[18px] bg-white px-3 py-2 shadow-sm"
              style={{ animationDelay: `${index * 150}ms` }}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f3efe8] text-[#1f6657]">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-[#60736d]">{label}</p>
                <p className="truncate text-sm font-semibold text-[#142620]">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-2 top-[58%] z-20 hidden rounded-[24px] border border-white/16 bg-[#1f6657]/78 p-4 text-white shadow-[0_24px_70px_-38px_rgba(0,0,0,0.95)] backdrop-blur-2xl animate-hero-float-delayed sm:block">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-[#f6d8c4]" />
          <div>
            <p className="text-xs text-white/64">Reception calls</p>
            <p className="text-lg font-bold">Down 42%</p>
          </div>
        </div>
      </div>

      <div className="absolute left-4 top-[28%] z-30 hidden rounded-[22px] border border-white/16 bg-white/12 p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-hero-float lg:block">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-[#f0834c]" />
          <div>
            <p className="text-xs text-white/62">Clinic status</p>
            <p className="text-lg font-bold text-white">Running on time</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const PathStep = ({
  icon: Icon,
  title,
  text,
  side,
  index,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  side: "patient" | "clinic";
  index: number;
}) => {
  const isPatient = side === "patient";

  return (
    <div className={`relative md:flex md:min-h-[112px] md:items-center ${isPatient ? "md:justify-start" : "md:justify-end"}`}>
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-px w-10 -translate-y-1/2 bg-primary/25 md:block" />
      <div className="hidden md:block">
        <div className={`absolute top-1/2 h-px w-12 -translate-y-1/2 ${isPatient ? "left-[calc(50%-48px)]" : "left-1/2"} bg-primary/20`} />
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-background bg-primary shadow-[0_0_0_6px_rgba(31,102,87,0.12)]" />
      </div>
      <article
        className={`w-full rounded-2xl border bg-background/90 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-34px_rgba(16,74,63,0.55)] md:w-[47%] ${
          isPatient ? "border-primary/25" : "border-accent/25"
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2.5 ${isPatient ? "bg-primary/10 text-primary" : "bg-accent/12 text-accent"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {isPatient ? "Patient side" : "Clinic side"} . Step {String(index + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
          </div>
        </div>
      </article>
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
  <div className="group flex items-start gap-4">
    <div className={`mt-1 rounded-lg p-2.5 transition-transform duration-300 group-hover:-translate-y-0.5 ${dark ? "bg-white/10" : accent ? "bg-accent/15" : "bg-secondary"}`}>
      <Icon className={dark ? "text-white" : accent ? "text-accent" : "text-primary"} size={18} />
    </div>
    <p className={`leading-7 transition-colors ${dark ? "text-white/80 group-hover:text-white" : "text-muted-foreground group-hover:text-foreground/90"}`}>{text}</p>
  </div>
);

const Step = ({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) => (
  <div className="group rounded-xl border border-border bg-background/75 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_18px_45px_-34px_rgba(16,74,63,0.55)]">
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
  <div className="group rounded-xl border border-border bg-card/80 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-36px_rgba(14,68,58,0.52)]">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <h3 className="mt-3 font-display text-2xl font-bold text-foreground">{title}</h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    <Button
      asChild
      className={`mt-6 w-full rounded-full transition-transform duration-300 group-hover:scale-[1.01] ${
        outline
          ? "border-primary/30 bg-background text-foreground hover:bg-secondary"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
      variant={outline ? "outline" : "default"}
    >
      <Link to={to}>{button}</Link>
    </Button>
  </div>
);

export default Index;
