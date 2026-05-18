import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  MapPin,
  QrCode,
  Search,
  Settings2,
  Smartphone,
  Stethoscope,
  Ticket,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

type LandingIcon = typeof Search;

type LandingContent = {
  eyebrow: string;
  title: string;
  description: string;
  audience: string;
  primaryCta: string;
  primaryHref: string;
  secondaryCta: string;
  secondaryHref: string;
  highlights: Array<{ icon: LandingIcon; title: string; text: string }>;
  steps: string[];
  keywords: string[];
  faqs: Array<{ question: string; answer: string }>;
};

export const seoLandingPages = {
  findClinics: {
    eyebrow: "Find clinics near you",
    title: "Find clinics near me and track your queue before you arrive.",
    description:
      "Krama helps patients discover clinics, take a digital token, book appointments, and follow live queue updates from their phone.",
    audience: "For patients searching for a nearby clinic, doctor, diagnostic lab, or consultation slot.",
    primaryCta: "Create Patient Account",
    primaryHref: "/patient/signup",
    secondaryCta: "Learn About Krama",
    secondaryHref: "/about",
    highlights: [
      { icon: MapPin, title: "Nearby clinic search", text: "Search for clinics around your location and choose the right visit flow." },
      { icon: Ticket, title: "Digital token", text: "Join a queue digitally instead of waiting at reception for updates." },
      { icon: Clock, title: "Live wait visibility", text: "See queue status and arrive closer to your consultation time." },
    ],
    steps: ["Search nearby clinics", "Select clinic and doctor", "Book or join the queue", "Track your token live"],
    keywords: [
      "find clinic near me",
      "clinics near me",
      "online doctor appointment system",
      "appointment booking system",
      "medical appointment scheduler",
      "doctor appointment software",
    ],
    faqs: [
      { question: "Can patients find clinics near them?", answer: "Yes. Krama includes a patient flow for finding clinics by location, category, doctor, and availability." },
      { question: "Can patients track a clinic queue?", answer: "Patients can receive a digital token and follow queue progress from their phone instead of calling reception." },
    ],
  },
  queueManagement: {
    eyebrow: "Queue management software",
    title: "Queue management for clinics, appointments, and walk-in patients.",
    description:
      "Krama gives clinics a simple digital queue management system for doctor-wise queues, patient tokens, appointments, and live status updates.",
    audience: "For clinic owners looking for a practical way to organize daily patient flow.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Patient Signup",
    secondaryHref: "/patient/signup",
    highlights: [
      { icon: Users, title: "Patient flow", text: "Handle walk-ins and scheduled appointments in one calmer operating flow." },
      { icon: CalendarClock, title: "Time slots", text: "Organize doctor availability and appointments with clear slot status." },
      { icon: Smartphone, title: "Patient updates", text: "Give patients live visibility so they do not need to call reception repeatedly." },
    ],
    steps: ["Register clinic", "Add doctors and timings", "Start accepting patients", "Manage queue status live"],
    keywords: [
      "clinic management software",
      "clinic management system",
      "queue management system for clinics",
      "patient queue management software",
      "clinic token system",
      "clinic automation software",
      "software for clinics",
      "software for small clinics",
      "clinic software India",
      "best clinic software in India",
    ],
    faqs: [
      { question: "What is clinic queue management?", answer: "It is the process of organizing walk-ins, booked appointments, tokens, and doctor availability so patients move through the clinic in a clear order." },
      { question: "How does Krama help manage queues?", answer: "Krama gives clinics queue controls, time slots, digital tokens, and live status updates for patients." },
    ],
  },
  controlQueue: {
    eyebrow: "Control queue digitally",
    title: "Control clinic queues without crowding your reception desk.",
    description:
      "Krama helps clinics move to the next patient, manage waiting lists, skip tokens when needed, and keep patients informed in real time.",
    audience: "For reception teams and doctors who need fast daily controls for patient movement.",
    primaryCta: "Start Clinic Setup",
    primaryHref: "/clinic/register",
    secondaryCta: "See Queue Management",
    secondaryHref: "/queue-management",
    highlights: [
      { icon: Settings2, title: "Queue controls", text: "Move, skip, and update patient status from a clean clinic dashboard." },
      { icon: Building2, title: "Clinic operations", text: "Support multiple doctors and appointment flows as your clinic grows." },
      { icon: CheckCircle2, title: "Clear status", text: "Keep staff and patients aligned on who is waiting, serving, or completed." },
    ],
    steps: ["Open clinic queue", "Call the next token", "Update patient status", "Keep the waiting room informed"],
    keywords: [
      "control queue",
      "clinic control queue",
      "digital queue control",
      "manage patient queue",
      "reception management software for clinics",
      "doctor dashboard software",
      "clinic workflow automation",
      "patient management software",
    ],
    faqs: [
      { question: "Can clinic staff control the queue from a dashboard?", answer: "Yes. Krama includes next, skip, complete, refresh, and live clinic status controls." },
      { question: "Can walk-in and online patients be handled together?", answer: "Krama marks patient source and helps clinics manage walk-ins, desk entries, and online appointments in the same queue view." },
    ],
  },
  digitalToken: {
    eyebrow: "Digital token system",
    title: "Digital token system for clinics and diagnostic centres.",
    description:
      "Krama replaces confusing manual token flows with digital tokens, live queue tracking, appointment visibility, and patient-friendly updates.",
    audience: "For clinics replacing paper tokens, manual numbering, or unclear reception calls.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Create Patient Account",
    secondaryHref: "/patient/signup",
    highlights: [
      { icon: Ticket, title: "Online tokens", text: "Let patients receive a clear token number and follow progress digitally." },
      { icon: Clock, title: "Lower waiting stress", text: "Patients can plan arrival around the real queue instead of guessing." },
      { icon: Smartphone, title: "Mobile-first flow", text: "Works naturally from a phone for patients, reception, and clinic teams." },
    ],
    steps: ["Create token", "Track live queue", "Get visit updates", "Arrive closer to turn"],
    keywords: [
      "digital token system",
      "clinic token system",
      "online token for clinic",
      "doctor appointment token",
      "hospital queue management system",
      "patient queue management software",
      "digital healthcare platform",
    ],
    faqs: [
      { question: "What is a digital token system?", answer: "It gives patients a digital number for their visit and lets the clinic update queue progress from a dashboard." },
      { question: "Does Krama support clinic tokens?", answer: "Yes. Krama supports appointment tokens, walk-in tokens, and live queue status." },
    ],
  },
  manageClinicQueue: {
    eyebrow: "Manage queue in clinic",
    title: "How to manage a queue in a clinic without confusing patients.",
    description:
      "Use Krama to organize clinic queues with time slots, live status, digital tokens, and simple controls for next, skip, and completed patients.",
    audience: "For clinic owners searching how to manage patient queues better.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "View Control Queue",
    secondaryHref: "/control-queue",
    highlights: [
      { icon: CalendarClock, title: "Session planning", text: "Create morning, afternoon, or evening slots and control when each slot is open." },
      { icon: Users, title: "One waiting list", text: "See who is waiting, currently serving, completed, or delayed." },
      { icon: Settings2, title: "Staff actions", text: "Reception can call next patient, skip when needed, and finish a visit." },
    ],
    steps: ["Set clinic time slots", "Start the clinic live window", "Add appointments and walk-ins", "Serve patients in order"],
    keywords: [
      "how to manage queue in clinic",
      "manage clinic queue",
      "clinic queue solution",
      "patient queue system",
      "clinic administration software",
      "clinic appointment management",
      "medical office software",
      "doctor clinic software",
    ],
    faqs: [
      { question: "How can I manage a clinic queue?", answer: "Start by separating time slots, giving every patient a token, and using one dashboard to update waiting, serving, skipped, and completed status." },
      { question: "Can Krama replace a manual queue register?", answer: "Krama can reduce manual token writing by moving queue status and patient tokens into a digital clinic flow." },
    ],
  },
  reduceWaitingTime: {
    eyebrow: "Reduce patient waiting time",
    title: "Reduce patient waiting time with live queue visibility.",
    description:
      "Krama helps clinics reduce waiting-room pressure by showing patients appointment slots, queue position, and token status before they arrive.",
    audience: "For clinics asking how to reduce patient waiting time and improve patient experience.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Find Clinics",
    secondaryHref: "/find-clinics-near-me",
    highlights: [
      { icon: Clock, title: "Less guessing", text: "Patients can see the current queue instead of arriving too early." },
      { icon: Smartphone, title: "Fewer calls", text: "Live token visibility reduces repeated phone calls to reception." },
      { icon: CheckCircle2, title: "Clear order", text: "A visible queue helps patients trust the process and understand their turn." },
    ],
    steps: ["Let patients book or join digitally", "Show live token status", "Update serving status quickly", "Tell patients when to come closer"],
    keywords: [
      "reduce patient waiting time",
      "reduce clinic waiting time",
      "avoid clinic waiting",
      "waiting time solution for clinics",
      "patient management software",
      "outpatient management system",
      "healthcare management software",
    ],
    faqs: [
      { question: "How can clinics reduce patient wait time?", answer: "Clinics can use appointments, time slots, digital tokens, and live queue updates so patients know when to arrive." },
      { question: "Does Krama remove waiting completely?", answer: "No system can remove every delay, but Krama makes the wait visible, organized, and easier for patients and staff." },
    ],
  },
  hospitalQueue: {
    eyebrow: "Hospital queue management",
    title: "Hospital and OPD queue management for busy patient counters.",
    description:
      "Krama supports hospital-style OPD and clinic queue flows with digital tokens, time slots, walk-in handling, and live patient status.",
    audience: "For small hospitals, OPD counters, and multi-doctor clinics handling heavy patient flow.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "OPD Queue Management",
    secondaryHref: "/opd-queue-management",
    highlights: [
      { icon: Building2, title: "OPD-style flow", text: "Organize patients by session, token, doctor, and availability." },
      { icon: Stethoscope, title: "Doctor-wise queues", text: "Support clinic workflows where multiple doctors serve patients across slots." },
      { icon: Users, title: "Crowd control", text: "Reduce waiting-room confusion by keeping patient movement visible." },
    ],
    steps: ["Register the facility", "Add doctors and specializations", "Open sessions for the day", "Track patient movement"],
    keywords: [
      "hospital management software",
      "hospital queue management",
      "hospital token system",
      "hospital queue management system",
      "hospital ERP software",
      "hospital software India",
      "OPD queue software",
      "patient flow hospital",
    ],
    faqs: [
      { question: "Can Krama work for OPD queues?", answer: "Krama is designed around clinic and OPD-like flows: tokens, time slots, doctors, walk-ins, and live status updates." },
      { question: "Is this only for clinics?", answer: "The current app is strongest for clinics, diagnostic centres, and small OPD-style setups." },
    ],
  },
  opdQueue: {
    eyebrow: "OPD queue management",
    title: "OPD queue management for appointments, walk-ins, and tokens.",
    description:
      "Krama helps OPD-style clinics organize daily sessions, issue digital tokens, and keep patients updated as the queue moves.",
    audience: "For clinics and OPD desks searching for a simpler patient queue workflow.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Digital Token System",
    secondaryHref: "/digital-token-system",
    highlights: [
      { icon: Ticket, title: "OPD tokens", text: "Create a clear token for each patient visit." },
      { icon: CalendarClock, title: "Daily sessions", text: "Split the day into time slots so patients can choose suitable visits." },
      { icon: Settings2, title: "Queue desk tools", text: "Call next, skip, complete, and refresh queues from one screen." },
    ],
    steps: ["Create sessions", "Let patients join or book", "Issue tokens", "Serve patients with live controls"],
    keywords: [
      "OPD queue management",
      "OPD management software",
      "OPD token system",
      "outpatient queue software",
      "outpatient management system",
      "doctor OPD queue",
      "doctor patient management system",
      "patient history management system",
    ],
    faqs: [
      { question: "What does OPD queue management mean?", answer: "It means organizing outpatients by token, appointment time, doctor, and current serving status." },
      { question: "Can patients join from a QR code?", answer: "Yes. Krama includes a QR-style join queue flow for walk-in patients." },
    ],
  },
  waitingRoom: {
    eyebrow: "Waiting room management",
    title: "Waiting room management that keeps patients informed.",
    description:
      "Krama helps clinics reduce crowding by moving queue visibility to the phone and giving staff a simple way to update patient status.",
    audience: "For clinics trying to avoid crowded waiting rooms and repeated reception questions.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Reduce Waiting Time",
    secondaryHref: "/reduce-patient-waiting-time",
    highlights: [
      { icon: Smartphone, title: "Phone-based updates", text: "Patients can track their token without standing at reception." },
      { icon: Clock, title: "Arrive closer to turn", text: "Queue visibility helps patients plan their visit more calmly." },
      { icon: Users, title: "Less crowding", text: "A clearer queue can reduce unnecessary pressure inside the waiting area." },
    ],
    steps: ["Give patients digital tokens", "Display live status", "Update progress from reception", "Let patients wait smarter"],
    keywords: [
      "waiting room management",
      "clinic waiting room software",
      "reduce waiting room crowd",
      "patient waiting room solution",
      "reception management software for clinics",
      "clinic workflow automation",
      "patient queue management software",
    ],
    faqs: [
      { question: "How can a clinic manage a crowded waiting room?", answer: "Use digital tokens, appointment slots, and live queue tracking so patients do not need to physically crowd around reception." },
      { question: "Does Krama show queue position?", answer: "Krama supports live token and queue status views for patients." },
    ],
  },
  qrQueue: {
    eyebrow: "QR code queue system",
    title: "QR code queue system for walk-in clinic patients.",
    description:
      "Krama lets walk-in patients join a clinic queue from a QR-style flow, enter basic details, choose an available slot, and receive a token.",
    audience: "For clinics that want patients to scan, join, and wait without paper forms.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Walk-in Management",
    secondaryHref: "/walk-in-patient-management",
    highlights: [
      { icon: QrCode, title: "Scan and join", text: "Patients can enter the queue from a clinic-specific join link." },
      { icon: Ticket, title: "Token result", text: "The patient receives a token and position after joining." },
      { icon: Smartphone, title: "No app install", text: "The flow is mobile-first and built for quick walk-in use." },
    ],
    steps: ["Patient scans clinic QR", "Chooses quick booking or signup", "Selects available slot", "Receives token"],
    keywords: [
      "QR code queue system",
      "scan QR join queue",
      "clinic QR token",
      "walk-in QR queue",
      "patient registration software",
      "clinic token system",
      "appointment booking system",
    ],
    faqs: [
      { question: "Can walk-in patients join with QR?", answer: "Yes. Krama has a clinic join route intended for QR codes and quick walk-in token creation." },
      { question: "Do patients need an account?", answer: "They can sign up for the full experience or use quick booking for a simpler visit flow." },
    ],
  },
  doctorAppointment: {
    eyebrow: "Doctor appointment system",
    title: "Doctor appointment and queue system in one clinic flow.",
    description:
      "Krama combines appointment booking, doctor selection, time slots, and live token tracking so clinics can manage visits end to end.",
    audience: "For clinics that need both online appointments and daily queue control.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "Patient Signup",
    secondaryHref: "/patient/signup",
    highlights: [
      { icon: Stethoscope, title: "Doctor selection", text: "Patients can select doctors during booking where clinic data supports it." },
      { icon: CalendarClock, title: "Appointment slots", text: "Time slots keep the day structured and easier to manage." },
      { icon: Ticket, title: "Token on visit", text: "Appointments connect into the queue with a clear token experience." },
    ],
    steps: ["Patient selects clinic", "Chooses time slot", "Selects doctor", "Receives appointment token"],
    keywords: [
      "doctor appointment software",
      "doctor appointment system",
      "clinic appointment booking",
      "appointment queue management",
      "doctor booking software",
      "doctor scheduling software",
      "online doctor appointment system",
      "medical appointment scheduler",
      "doctor management software",
      "best software for doctors",
    ],
    faqs: [
      { question: "Can Krama manage appointments and queues together?", answer: "Yes. It includes appointment booking, slot selection, digital tokens, and clinic queue controls." },
      { question: "Can clinics add doctors?", answer: "Clinic registration captures doctor details and the app supports doctor-oriented booking flows." },
    ],
  },
  walkInPatient: {
    eyebrow: "Walk-in patient management",
    title: "Walk-in patient management without paper token confusion.",
    description:
      "Krama helps clinics handle walk-in patients with quick booking, digital tokens, source labels, available slots, and live queue controls.",
    audience: "For clinics that receive daily walk-ins and need them mixed cleanly with appointments.",
    primaryCta: "Register Clinic",
    primaryHref: "/clinic/register",
    secondaryCta: "QR Queue System",
    secondaryHref: "/qr-code-queue-system",
    highlights: [
      { icon: Users, title: "Walk-ins and appointments", text: "See where each patient came from and serve them in the right flow." },
      { icon: Ticket, title: "Instant token", text: "Quick-book walk-ins can receive a token after entering their details." },
      { icon: Settings2, title: "Queue actions", text: "Clinic staff can move the line forward and manage exceptions." },
    ],
    steps: ["Patient arrives", "Joins from QR or desk", "Gets token", "Clinic serves in queue order"],
    keywords: [
      "walk-in patient management",
      "walk-in queue system",
      "clinic walk-in token",
      "manage walk-in patients",
      "patient management software",
      "patient registration software",
      "doctor patient management system",
      "clinic workflow automation",
    ],
    faqs: [
      { question: "How do clinics manage walk-in patients digitally?", answer: "A QR join flow, quick details form, and digital token can replace manual paper tokens." },
      { question: "Can walk-ins be shown separately?", answer: "Krama labels walk-in source in the queue so staff can understand where patients came from." },
    ],
  },
} satisfies Record<string, LandingContent>;

export const seoRoutes = {
  "/find-clinics-near-me": "findClinics",
  "/queue-management": "queueManagement",
  "/control-queue": "controlQueue",
  "/digital-token-system": "digitalToken",
  "/manage-queue-in-clinic": "manageClinicQueue",
  "/reduce-patient-waiting-time": "reduceWaitingTime",
  "/hospital-queue-management": "hospitalQueue",
  "/opd-queue-management": "opdQueue",
  "/clinic-waiting-room-management": "waitingRoom",
  "/qr-code-queue-system": "qrQueue",
  "/doctor-appointment-system": "doctorAppointment",
  "/walk-in-patient-management": "walkInPatient",
} as const;

export type SeoLandingKey = keyof typeof seoLandingPages;

const relatedSolutions = Object.entries(seoRoutes).map(([href, key]) => ({
  href,
  title: seoLandingPages[key].eyebrow,
}));

const SeoLandingPage = ({ page }: { page: SeoLandingKey }) => {
  const content = seoLandingPages[page];
  const routeEntry = Object.entries(seoRoutes).find(([, key]) => key === page);
  const canonicalPath = routeEntry?.[0] || "/";
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `https://krama.digital${canonicalPath}`,
        url: `https://krama.digital${canonicalPath}`,
        name: content.title,
        description: content.description,
        isPartOf: {
          "@type": "WebSite",
          name: "Krama",
          url: "https://krama.digital/",
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: content.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
  const currentRelated = relatedSolutions.filter((item) => seoRoutes[item.href as keyof typeof seoRoutes] !== page).slice(0, 6);

  return (
    <div className="min-h-screen overflow-hidden">
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
      <section className="section-container px-4 pb-14 pt-10 md:px-8 md:pb-20 md:pt-16">
        <div className="grid min-w-0 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="min-w-0 max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">{content.eyebrow}</p>
            <h1 className="mt-5 max-w-full break-words font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl md:text-6xl">
              {content.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{content.description}</p>
            <p className="mt-4 max-w-2xl rounded-2xl border border-border/70 bg-white/75 px-5 py-4 text-sm leading-6 text-muted-foreground">
              {content.audience}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to={content.primaryHref}>
                  {content.primaryCta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to={content.secondaryHref}>{content.secondaryCta}</Link>
              </Button>
            </div>
          </div>

          <div className="min-w-0 rounded-[28px] border border-border/70 bg-white/80 p-4 shadow-sm sm:rounded-[32px] sm:p-6">
            <div className="min-w-0 rounded-[24px] bg-primary p-5 text-primary-foreground sm:rounded-[26px] sm:p-6">
              <p className="text-sm uppercase tracking-[0.22em] text-primary-foreground/70">Live queue</p>
              <div className="mt-6 grid min-w-0 grid-cols-2 gap-3">
                <div className="min-w-0 rounded-[20px] bg-white/10 p-4 sm:rounded-[22px]">
                  <p className="text-xs text-primary-foreground/70">Now serving</p>
                  <p className="mt-2 break-words font-display text-3xl font-bold sm:text-4xl">A-12</p>
                </div>
                <div className="min-w-0 rounded-[20px] bg-white/10 p-4 sm:rounded-[22px]">
                  <p className="text-xs text-primary-foreground/70">Your token</p>
                  <p className="mt-2 break-words font-display text-3xl font-bold sm:text-4xl">A-17</p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid gap-3">
              {content.steps.map((step, index) => (
                <div key={step} className="flex min-w-0 items-center gap-3 rounded-[20px] border border-border/70 bg-background/80 p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 font-medium text-foreground">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-secondary/45 py-14 md:py-20">
        <div className="section-container px-4 md:px-8">
          <div className="grid gap-5 md:grid-cols-3">
            {content.highlights.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-[28px] border border-border/70 bg-white/80 p-6 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h2 className="mt-5 font-display text-xl font-bold text-foreground">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section-container grid gap-8 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[0.82fr_1.18fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Search questions</p>
          <h2 className="mt-4 font-display text-3xl font-bold text-foreground">What this page answers.</h2>
        </div>
        <div className="grid gap-4">
          {content.faqs.map((faq) => (
            <article key={faq.question} className="rounded-[24px] border border-border/70 bg-white/80 p-5 shadow-sm">
              <h3 className="font-semibold text-foreground">{faq.question}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-white/60 py-10 md:py-14">
        <div className="section-container px-4 md:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">Related searches</p>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">
              This page is written for searches like {content.keywords.join(", ")}.
            </p>
          </div>
        </div>
      </section>

      <section className="section-container px-4 py-14 md:px-8 md:py-20">
        <div className="rounded-[32px] border border-border/70 bg-white/80 p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary">More Krama solutions</p>
              <h2 className="mt-3 font-display text-3xl font-bold text-foreground">Explore related queue problems.</h2>
            </div>
            <Button asChild variant="outline">
              <Link to="/clinic/register">Register Clinic</Link>
            </Button>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {currentRelated.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                {item.title}
                <ArrowRight className="h-4 w-4 text-primary" />
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default SeoLandingPage;
