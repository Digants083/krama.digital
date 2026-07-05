import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/config/app";
import {
  ArrowRight,
  Brain,
  Building2,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  Smartphone,
  Stethoscope,
  Ticket,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";

const problems = [
  {
    icon: Stethoscope,
    title: "What Krama is",
    text: "Krama is a clinic queue, appointment, and patient-flow system. It helps patients book, receive a live token, track their turn, and continue care after the visit.",
  },
  {
    icon: Clock,
    title: "The problem",
    text: "Patients wait without knowing how long it will take. Clinics handle crowds, repeated questions, delays, and scattered visit details at the same time.",
  },
  {
    icon: Ticket,
    title: "The solution",
    text: "Krama makes the queue visible. It connects doctor slots, digital tokens, live delay updates, reports, billing, reminders, and patient history into one flow.",
  },
  {
    icon: Brain,
    title: "The future update",
    text: "Our next step is AI for patient-doctor conversations: summaries, reminders, patient instructions, and better context for doctors before the next plan.",
  },
];

const flow = [
  {
    icon: Smartphone,
    label: "Patient starts",
    title: "Login and choose the reason",
    text: "The patient enters Krama, verifies securely, and selects why they need to visit.",
  },
  {
    icon: MapPin,
    label: "Clinic choice",
    title: "Pick the clinic and slot",
    text: "Krama shows available clinic sessions, doctors, and time slots so the patient can choose clearly.",
  },
  {
    icon: Ticket,
    label: "Live token",
    title: "Track position and ETA",
    text: "After booking, the patient sees their token, people ahead, estimated wait, and live queue movement.",
  },
  {
    icon: Building2,
    label: "Clinic control",
    title: "Staff manage time and queue",
    text: "Clinics control doctor slots, add delays, move the queue, manage billing, and organize patient records.",
  },
  {
    icon: Brain,
    label: "Future care",
    title: "AI summaries and reminders",
    text: "The future AI layer will listen to the patient-doctor conversation, create a useful summary, remind patients what to follow, and help doctors plan better treatment from previous context.",
  },
];

const capabilities = [
  "Digital queue tokens",
  "Live wait-time updates",
  "Doctor-wise time slots",
  "Delay controls",
  "Patient reports",
  "Billing support",
  "AI visit summaries",
  "Conversation reminders",
  "Follow-up reminders",
];

const links = [
  { to: "/patient/signup", label: "Patient Registration" },
  { to: "/clinic/register", label: "Clinic Registration" },
  { to: "/patient/login", label: "Patient Login" },
  { to: "/clinic/login", label: "Clinic Login" },
];

const AboutUs = () => {
  useEffect(() => {
    document.body.classList.add("about-route");
    return () => document.body.classList.remove("about-route");
  }, []);

  return (
    <main className="about-page overflow-hidden bg-[#0E2620] text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=Fira+Code:wght@400&display=swap');
        body.about-route { background: #0E2620 !important; background-image: none !important; }
        body.about-route .krama-ambient { background: #0E2620 !important; overflow: visible; }
        body.about-route .krama-ambient::before { display: none; }
        .about-page { font-family: 'Inter', system-ui, sans-serif; }
        .about-serif { font-family: 'EB Garamond', Georgia, serif; letter-spacing: 0; }
        .about-mono { font-family: 'Fira Code', ui-monospace, monospace; }
        @media (max-width: 640px) {
          .about-page h1, .about-page h2 { overflow-wrap: anywhere; }
        }
      `}</style>
      <section className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden">
        <img
          src="/krama-hero-clinic.png"
          alt="Patients using phones in a calm clinic waiting room"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,38,32,0.96)_0%,rgba(14,38,32,0.8)_42%,rgba(14,38,32,0.5)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_22%_48%,rgba(34,211,238,0.18),transparent_34%),linear-gradient(to_bottom,rgba(14,38,32,0.2),rgba(14,38,32,0.92))]" />

        <div className="section-container relative z-10 flex min-h-[calc(100svh-4rem)] items-center px-4 py-16 md:px-8">
          <div className="max-w-4xl">
            <p className="about-mono text-xs font-medium uppercase tracking-[0.32em] text-[#22D3EE]">
              About Krama
            </p>
            <h1 className="about-serif mt-6 max-w-4xl text-5xl font-normal leading-[1.02] text-white sm:text-6xl md:text-7xl">
              Krama makes clinic visits easier from start to finish.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#C4D8D0] md:text-lg">
              Krama helps patients book appointments, get live queue tokens, track their turn, and follow care instructions after the visit. For clinics, it brings time slots, queue control, reports, billing, and patient history into one calmer system.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-12 rounded-lg bg-[#F8B4D9] px-6 text-[#0E2620] hover:bg-[#FBCFE8]">
                <Link to="/patient/signup">
                  Start as patient
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 rounded-lg border-white/25 bg-white/5 px-6 text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/clinic/register">Register clinic</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 md:px-8 md:py-24">
        <div className="section-container">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <p className="about-mono text-xs uppercase tracking-[0.28em] text-[#22D3EE]">Krama in clear words</p>
              <h2 className="about-serif mt-4 max-w-xl text-4xl font-normal leading-tight md:text-5xl">
                What we are solving, and where we are going next.
              </h2>
            </div>
            <p className="max-w-3xl text-base leading-8 text-[#C4D8D0]">
              Krama starts with the queue, but the vision is bigger. We want every patient to understand their visit before, during, and after care, while every doctor gets enough context to make a better plan.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {problems.map(({ icon: Icon, title, text }) => (
              <article key={title} className="border border-white/10 bg-white/[0.025] p-6 backdrop-blur">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#22D3EE]/10 text-[#22D3EE]">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="about-serif mt-5 text-2xl font-normal leading-tight">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-[#C4D8D0]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#102b24] px-4 py-16 md:px-8 md:py-24">
        <div className="section-container grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div>
            <p className="about-mono text-xs uppercase tracking-[0.28em] text-[#22D3EE]">What we do</p>
            <h2 className="about-serif mt-4 text-4xl font-normal leading-tight md:text-5xl">
              The solution is visibility for both sides.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[#C4D8D0]">
              Patients get a clear path: login, book, receive a token, and track the queue. Clinics get the control layer behind it: doctor sessions, availability, queue movement, delay updates, billing, reports, and patient history.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {capabilities.map((item) => (
                <div key={item} className="flex items-center gap-3 border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-[#E6F8F2]">
                  <CheckCircle2 className="h-4 w-4 text-[#22D3EE]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <figure className="relative min-h-[420px] overflow-hidden border border-white/10">
            <img
              src="/krama-patient-phone.png"
              alt="Patient viewing a Krama token on a phone"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0E2620] via-[#0E2620]/25 to-transparent" />
            <figcaption className="absolute bottom-0 left-0 right-0 p-6">
              <p className="about-mono text-xs uppercase tracking-[0.22em] text-[#F8B4D9]">Live patient view</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/80">
                Token number, people ahead, estimated wait, and appointment status stay easy to reopen.
              </p>
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="px-4 py-16 md:px-8 md:py-24">
        <div className="section-container">
          <div className="max-w-3xl">
            <p className="about-mono text-xs uppercase tracking-[0.28em] text-[#22D3EE]">From start to end</p>
            <h2 className="about-serif mt-4 text-4xl font-normal leading-tight md:text-5xl">
              One connected journey for patients and clinics.
            </h2>
          </div>

          <div className="mt-10 grid gap-4">
            {flow.map(({ icon: Icon, label, title, text }, index) => (
              <article
                key={title}
                className="grid gap-5 border border-white/10 bg-white/[0.025] p-5 backdrop-blur md:grid-cols-[72px_0.55fr_1fr] md:items-center md:p-6"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#22D3EE]/10 text-[#22D3EE]">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="about-mono text-xs uppercase tracking-[0.22em] text-[#22D3EE]">
                    {String(index + 1).padStart(2, "0")} / {label}
                  </p>
                  <h3 className="about-serif mt-2 text-2xl font-normal leading-tight">{title}</h3>
                </div>
                <p className="text-sm leading-7 text-[#C4D8D0]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-white/10 px-4 py-16 md:px-8 md:py-24">
        <img
          src="/krama-clinic-staff.png"
          alt="Clinic team using Krama for patient flow"
          className="absolute inset-0 h-full w-full object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-[#0E2620]/85" />
        <div className="section-container relative z-10 grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div>
            <p className="about-mono text-xs uppercase tracking-[0.28em] text-[#22D3EE]">Future update</p>
            <h2 className="about-serif mt-4 max-w-3xl text-4xl font-normal leading-tight md:text-5xl">
              Future update: AI that helps after the conversation.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[#C4D8D0]">
              We are building an AI layer for patient-doctor conversations. It can create a preview summary for the doctor, help the doctor understand earlier visits, and give the patient reminders for medicines, actions, follow-ups, and things to avoid.
            </p>
          </div>
          <div className="border border-white/10 bg-[#0E2620]/80 p-6 backdrop-blur">
            <div className="flex gap-3">
              <Mail className="mt-1 h-5 w-5 text-[#22D3EE]" />
              <div>
                <p className="about-serif text-2xl font-normal">Talk to Krama</p>
                <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-2 inline-block text-sm text-[#F8B4D9] hover:text-white">
                  {SUPPORT_EMAIL}
                </a>
              </div>
            </div>
            <div className="mt-6 grid gap-2">
              {links.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center justify-between border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white/85 transition hover:border-[#22D3EE]/40 hover:text-[#22D3EE]"
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};

export default AboutUs;
