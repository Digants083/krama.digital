import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  Clock,
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

const valueProps = [
  {
    icon: TicketCheck,
    title: "Digital tokens",
    text: "Join the queue from your phone — no paper chit, no standing in line.",
  },
  {
    icon: BarChart3,
    title: "Live tracking",
    text: "See your position, wait time, and when to head to the clinic.",
  },
  {
    icon: Clock,
    title: "Arrive on time",
    text: "Skip the crowded waiting room. Show up when your turn is close.",
  },
];

const queuePath = [
  { side: "patient" as const, icon: MapPin, title: "Patient finds clinic", text: "Find nearby clinics with a simple search flow." },
  { side: "clinic" as const, icon: Users, title: "Clinic receives entry", text: "Handle walk-ins and scheduled patients from one flow." },
  { side: "patient" as const, icon: Ticket, title: "Patient gets digital token", text: "Take a digital token before you arrive." },
  { side: "clinic" as const, icon: UserCheck, title: "Staff organizes queues", text: "Manage doctor-wise queues with less confusion." },
  { side: "patient" as const, icon: BarChart3, title: "Patient tracks live updates", text: "Track position in real time from your phone." },
  { side: "clinic" as const, icon: SkipForward, title: "Queue moves smoothly", text: "Move to next, skip, and update status quickly." },
  { side: "patient" as const, icon: Clock, title: "Patient arrives on time", text: "Reach the clinic close to your actual turn." },
  { side: "clinic" as const, icon: Activity, title: "Crowding stays lower", text: "Reduce crowding while giving patients live visibility." },
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

const ScrollReveal = ({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const Index = () => {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f3eb]">
      {/* Hero */}
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
                Smart clinic queue management
              </div>

              <h1 className="mt-7 max-w-4xl font-display text-5xl font-bold leading-[0.98] text-white sm:text-6xl lg:text-7xl xl:text-8xl">
                A clinic visit that moves with you.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-white/82 sm:text-xl">
                Book a visit, get a digital token, and track your queue live from your phone — so you arrive closer to your turn and skip the waiting-room guesswork.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg" className={primaryCtaClass}>
                  <Link to="/patient/login">
                    Patient Login
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className={secondaryCtaClass}>
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

      {/* Value props */}
      <section className="section-container px-4 py-14 md:px-8 md:py-16">
        <ScrollReveal>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">What is Krama?</p>
            <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">
              Digital queues for patients and clinics.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
              One platform that connects both sides — from finding a clinic to walking in at the right time.
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {valueProps.map((item, index) => (
            <ScrollReveal key={item.title} delay={index * 120}>
              <div className="group h-full rounded-[28px] border border-border/70 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-36px_rgba(14,68,58,0.45)]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-105">
                  <item.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-bold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Patient + clinic visuals */}
      <section className="section-container px-4 pb-4 md:px-8">
        <div className="grid gap-4 md:grid-cols-2">
          <ScrollReveal>
            <figure className="group relative overflow-hidden rounded-[28px]">
              <img
                src="/krama-patient-phone.png"
                alt="Patient tracking their clinic queue on a smartphone"
                className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#10251f]/80 via-[#10251f]/20 to-transparent" />
              <figcaption className="absolute bottom-0 left-0 right-0 p-6 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">For patients</p>
                <p className="mt-1 text-xl font-bold">Track your token live from anywhere.</p>
              </figcaption>
            </figure>
          </ScrollReveal>

          <ScrollReveal delay={150}>
            <figure className="group relative overflow-hidden rounded-[28px]">
              <img
                src="/krama-clinic-staff.png"
                alt="Clinic staff managing patient queue at reception"
                className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#10251f]/80 via-[#10251f]/20 to-transparent" />
              <figcaption className="absolute bottom-0 left-0 right-0 p-6 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">For clinics</p>
                <p className="mt-1 text-xl font-bold">Run queues smoothly from one dashboard.</p>
              </figcaption>
            </figure>
          </ScrollReveal>
        </div>
      </section>

      {/* Queue path */}
      <section className="section-container px-4 py-16 md:px-8 md:py-20">
        <ScrollReveal>
          <div className="relative overflow-hidden rounded-[32px] border border-[#e6ded3]/80 bg-gradient-to-b from-white via-[#fbfaf7] to-[#f3efe8] p-6 shadow-[0_24px_70px_-46px_rgba(18,80,70,0.55)] md:p-12">
            <div className="pointer-events-none absolute -left-20 top-16 h-56 w-56 rounded-full bg-primary/6 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 bottom-16 h-56 w-56 rounded-full bg-[#f0834c]/6 blur-3xl" />

            <div className="relative text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your queue path</p>
              <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">One clear path for patients and clinics.</h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
                Krama connects both sides in one moving flow, from discovery to arrival.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3.5 py-1.5 text-xs font-semibold text-primary">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Patient
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#f0834c]/20 bg-[#f0834c]/10 px-3.5 py-1.5 text-xs font-semibold text-[#c45a22]">
                  <span className="h-2 w-2 rounded-full bg-[#f0834c]" />
                  Clinic
                </span>
              </div>
            </div>

            {/* Desktop timeline */}
            <div className="relative mx-auto mt-12 hidden max-w-4xl md:block">
              <div className="pointer-events-none absolute bottom-8 left-1/2 top-8 w-[4px] -translate-x-1/2 overflow-hidden rounded-full bg-[#e8dcc8]">
                <div className="animate-path-shimmer h-full w-full bg-gradient-to-b from-primary/70 via-primary/40 to-[#f0834c]/60" />
              </div>
              <div className="pointer-events-none absolute left-1/2 top-8 h-3 w-3 -translate-x-1/2 animate-path-travel rounded-full bg-[#f6d8c4] shadow-[0_0_0_6px_rgba(246,216,196,0.35),0_0_18px_rgba(246,216,196,0.6)]" />

              <div>
                {queuePath.map((item, index) => (
                  <QueuePathRow key={item.title} {...item} index={index} isLast={index === queuePath.length - 1} />
                ))}
              </div>
            </div>

            {/* Mobile timeline */}
            <div className="relative mt-10 space-y-0 md:hidden">
              <div className="pointer-events-none absolute bottom-4 left-[19px] top-4 w-[3px] rounded-full bg-gradient-to-b from-primary/50 to-[#f0834c]/50" />
              {queuePath.map((item, index) => (
                <div key={item.title} className={`relative flex gap-4 ${index < queuePath.length - 1 ? "pb-8" : ""}`}>
                  <div
                    className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold shadow-[0_0_0_4px_#fbfaf7] ${
                      item.side === "patient" ? "bg-primary text-white" : "bg-[#f0834c] text-white"
                    }`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <PathCard {...item} className="flex-1" />
                </div>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* How it works */}
      <section className="bg-secondary/45 py-16 md:py-20">
        <div className="section-container px-4 md:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
            <ScrollReveal>
              <div className="relative overflow-hidden rounded-[32px] shadow-[0_28px_80px_-40px_rgba(31,92,84,0.5)]">
                <img
                  src="/krama-patient-phone.png"
                  alt="Patient checking queue status on phone"
                  className="aspect-[4/5] w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/30 to-transparent" />
                <div className="absolute bottom-6 left-6 right-6 rounded-2xl border border-white/20 bg-white/90 p-4 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your token</p>
                      <p className="font-display text-3xl font-bold text-primary">A-17</p>
                    </div>
                    <span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-soft-ping rounded-full bg-primary opacity-40" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                      Live
                    </span>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={120}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it works</p>
                <h2 className="mt-3 font-display text-3xl font-bold md:text-4xl">A simpler visit in four small steps.</h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground md:text-base">
                  No app download needed — search, get your token, and follow live updates until it&apos;s your turn.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {steps.map((step, index) => (
                    <ScrollReveal key={step.title} delay={index * 80}>
                      <Step icon={step.icon} title={step.title} desc={step.desc} stepNum={index + 1} />
                    </ScrollReveal>
                  ))}
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-container px-4 py-16 md:px-8 md:py-22">
        <ScrollReveal>
          <div className="relative overflow-hidden rounded-[36px] bg-foreground px-8 py-12 text-center text-white shadow-[0_28px_80px_-40px_rgba(10,30,26,0.9)] md:px-12">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f6d8c4]/55 to-transparent" />
            <p className="relative text-sm uppercase tracking-[0.3em] text-white/55">Ready to use Krama?</p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-bold leading-tight md:text-4xl">
              Skip the waiting-room guesswork. Start with a digital token.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/70 md:text-base">
              Patients can sign up and book in minutes. Clinics can register and start managing queues today.
            </p>

            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/patient/login">
                <Button size="lg" className={primaryCtaClass}>
                  Patient Login
                </Button>
              </Link>
              <Link to="/clinic/login">
                <Button size="lg" variant="outline" className={secondaryCtaClass}>
                  Clinic Login
                </Button>
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* Get started */}
      <section className="section-container px-4 pb-16 md:px-8">
        <ScrollReveal>
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
        </ScrollReveal>
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

const QueuePathRow = ({
  icon,
  title,
  text,
  side,
  index,
  isLast,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  side: "patient" | "clinic";
  index: number;
  isLast: boolean;
}) => {
  const isPatient = side === "patient";

  return (
    <div className={`grid grid-cols-[1fr_56px_1fr] items-center ${isLast ? "" : "pb-10"}`}>
      <div className="flex justify-end pr-5">
        {isPatient ? <PathCard icon={icon} title={title} text={text} side={side} /> : null}
      </div>

      <div className="relative z-10 flex justify-center">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full font-display text-xs font-bold shadow-[0_0_0_5px_#fbfaf7,0_10px_28px_-10px_rgba(31,102,87,0.45)] ${
            isPatient ? "bg-primary text-white" : "bg-[#f0834c] text-white"
          }`}
        >
          {String(index + 1).padStart(2, "0")}
        </div>
      </div>

      <div className="flex justify-start pl-5">
        {!isPatient ? <PathCard icon={icon} title={title} text={text} side={side} /> : null}
      </div>
    </div>
  );
};

const PathCard = ({
  icon: Icon,
  title,
  text,
  side,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  side: "patient" | "clinic";
  className?: string;
}) => {
  const isPatient = side === "patient";

  return (
    <article
      className={`group relative w-full max-w-[320px] overflow-hidden rounded-[22px] border p-5 shadow-[0_14px_36px_-24px_rgba(16,74,63,0.4)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_44px_-22px_rgba(16,74,63,0.48)] ${
        isPatient
          ? "border-primary/20 bg-gradient-to-br from-primary/[0.07] via-white to-white"
          : "border-[#f0834c]/25 bg-gradient-to-bl from-[#f0834c]/[0.08] via-white to-white"
      } ${className}`}
    >
      <div className={`absolute top-0 h-[3px] w-14 rounded-full ${isPatient ? "left-5 bg-primary" : "right-5 bg-[#f0834c]"}`} />

      {isPatient ? (
        <div className="pointer-events-none absolute -right-5 top-1/2 hidden h-px w-5 -translate-y-1/2 bg-gradient-to-r from-primary/30 to-transparent md:block" />
      ) : (
        <div className="pointer-events-none absolute -left-5 top-1/2 hidden h-px w-5 -translate-y-1/2 bg-gradient-to-l from-[#f0834c]/30 to-transparent md:block" />
      )}

      <div className="flex items-start gap-3.5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-105 ${
            isPatient ? "bg-primary/12 text-primary" : "bg-[#f0834c]/12 text-[#d4622a]"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
              isPatient ? "bg-primary/10 text-primary" : "bg-[#f0834c]/12 text-[#c45a22]"
            }`}
          >
            {isPatient ? "Patient" : "Clinic"}
          </span>
          <h3 className="mt-2 text-base font-bold leading-snug text-foreground">{title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
        </div>
      </div>
    </article>
  );
};

const Step = ({
  icon: Icon,
  title,
  desc,
  stepNum,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  stepNum: number;
}) => (
  <div className="group rounded-xl border border-border bg-background/75 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_18px_45px_-34px_rgba(16,74,63,0.55)]">
    <div className="flex items-center justify-between">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="text-primary" size={21} />
      </div>
      <span className="font-display text-2xl font-bold text-primary/20">{String(stepNum).padStart(2, "0")}</span>
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
