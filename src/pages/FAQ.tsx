import { Link } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  HelpCircle,
  LogIn,
  MapPin,
  ShieldCheck,
  Ticket,
  UserRound,
} from "lucide-react";

type FaqItem = {
  question: string;
  answer: string;
};

type FaqSection = {
  title: string;
  description: string;
  items: FaqItem[];
};

const faqSections: FaqSection[] = [
  {
    title: "About Krama",
    description: "What Krama is, who it is for, and the problem it solves.",
    items: [
      {
        question: "What is Krama?",
        answer:
          "Krama is a digital queue and appointment platform for clinics and patients. Patients can find clinics, book a visit, receive a token, and track queue progress from their phone. Clinics can manage time slots, online appointments, walk-ins, and live queue movement from one dashboard.",
      },
      {
        question: "Why should a patient use Krama?",
        answer:
          "Patients use Krama to reduce unnecessary waiting. Instead of reaching early and sitting in a crowded waiting room, they can search for clinics, book an available slot, view their token, and follow live queue updates before visiting.",
      },
      {
        question: "Why should a clinic use Krama?",
        answer:
          "Clinics use Krama to keep patient flow clearer. Staff can create time slots, open or close availability, start the clinic queue, move to the next patient, skip a patient, manage walk-ins, and view patient reports from the clinic dashboard.",
      },
      {
        question: "Is Krama only for large hospitals?",
        answer:
          "No. Krama is built for clinics, OPDs, diagnostic centres, and healthcare practices that need a simpler way to handle appointments, walk-ins, and token queues.",
      },
    ],
  },
  {
    title: "Patient Questions",
    description: "How patients sign up, find clinics, book appointments, and track tokens.",
    items: [
      {
        question: "How does a patient create an account?",
        answer:
          "Open Patient Signup, enter your name, phone number, email, blood group if needed, and password. Krama sends an OTP to your email. After you enter the 6-digit OTP, your patient account is created.",
      },
      {
        question: "How does a patient log in?",
        answer:
          "Open Patient Login, enter your registered email and password, and submit the form. After login, you will reach the patient dashboard where you can book a new appointment, view your appointment token, and write feedback.",
      },
      {
        question: "What can patients do on the platform?",
        answer:
          "Patients can find nearby clinics, search clinics by name, address, doctor, or specialization, filter by clinic category, book available appointment slots, view booking confirmation, track token information, manage their profile, and write reviews for clinics.",
      },
      {
        question: "Why does Krama ask for location access?",
        answer:
          "Location access helps Krama show nearby clinics and sort them by distance. If you search by clinic name, address, doctor, or specialization, Krama can still show matching clinics even outside the nearby radius.",
      },
      {
        question: "How does appointment booking work?",
        answer:
          "After choosing a clinic, you select an available time slot, pick a doctor, choose a date, and confirm the appointment. Krama then creates a booking and shows your appointment details with a token.",
      },
      {
        question: "Can patients choose a doctor?",
        answer:
          "Yes. During booking, patients can choose from the doctors listed for that clinic before confirming the appointment.",
      },
      {
        question: "Can patients reset a forgotten password?",
        answer:
          "Yes. Patient Login includes a Forgot password link. The reset flow verifies the account using OTP before allowing a new password to be set.",
      },
      {
        question: "Can patients give feedback after a visit?",
        answer:
          "Yes. The patient dashboard includes a review option so patients can share feedback about clinics they have visited.",
      },
    ],
  },
  {
    title: "Clinic Questions",
    description: "How clinics register, log in, set up time slots, and manage the queue.",
    items: [
      {
        question: "How does a clinic register on Krama?",
        answer:
          "Open Clinic Registration and complete the clinic details first: clinic name, categories, email, phone, address, and password. Then add doctor details such as doctor name, specialization, experience, and qualifications. Krama sends an OTP to the clinic email before registration is completed.",
      },
      {
        question: "How does a clinic log in?",
        answer:
          "Open Clinic Login, enter the clinic email or clinic ID and password, then submit the form. After login, the clinic dashboard gives access to Manage Time, Control Queue, Look Up Patients, Doctor Dashboard, Patient Reports, and Profile.",
      },
      {
        question: "What can clinics manage from the dashboard?",
        answer:
          "Clinics can manage appointment time slots, start or stop live queue availability, control the active queue, handle next and skipped patients, look up patients, view doctor dashboard information, update clinic profile details, and access patient reports.",
      },
      {
        question: "How do clinic time slots work?",
        answer:
          "Clinics can create up to three sessions such as morning, afternoon, and evening. Each slot has a start time, end time, and open or closed status. Patients only see slots that are available for booking.",
      },
      {
        question: "How does a clinic go live?",
        answer:
          "In Control Queue, the clinic can start the live queue when the configured time window allows it. Once live, patients can be accepted into the active queue and staff can manage who is served next.",
      },
      {
        question: "What happens when a clinic stops the queue?",
        answer:
          "Stopping the clinic takes it offline for queue activity. This helps the clinic prevent new queue activity when the doctor is unavailable, the session is over, or the clinic is done for the day.",
      },
      {
        question: "Can clinics manage walk-in patients?",
        answer:
          "Yes. Krama supports walk-in patient flow along with online appointments. Walk-ins are shown with their source in the clinic queue so staff can distinguish them from online bookings.",
      },
      {
        question: "Can clinics move or skip patients in the queue?",
        answer:
          "Yes. Clinic staff can move to the next patient, mark the current patient as completed, skip when needed, and push an expired-slot patient to the next available slot when applicable.",
      },
    ],
  },
  {
    title: "Tokens, Queue, And Visits",
    description: "Common questions about live status, tokens, and arriving at the clinic.",
    items: [
      {
        question: "What is a digital token?",
        answer:
          "A digital token is the appointment or queue number assigned to a patient. It helps the patient and clinic understand the patient's place in the queue without relying on manual calling or repeated phone updates.",
      },
      {
        question: "How does live queue tracking work?",
        answer:
          "When the clinic queue is active, Krama shows queue status based on the clinic's current serving flow. Patients can use their booking or token details to understand when their turn is closer.",
      },
      {
        question: "Should patients still reach the clinic early?",
        answer:
          "Patients should follow the clinic's guidance and arrive with enough time for check-in. Krama reduces blind waiting, but medical queues can still change because of emergencies, delayed consultations, or clinic decisions.",
      },
      {
        question: "What if a time slot is not available?",
        answer:
          "If no time slots are available, the patient may need to try another time, another clinic, or contact the clinic directly. Clinics control slot availability from their dashboard.",
      },
      {
        question: "Can queue times change?",
        answer:
          "Yes. Queue timing can change when a consultation takes longer, a patient is skipped, a walk-in is added, or the clinic changes availability. Krama is meant to make those changes visible and easier to manage.",
      },
    ],
  },
  {
    title: "Account And Support",
    description: "Login, password, verification, and support questions.",
    items: [
      {
        question: "Why do patients and clinics need OTP verification?",
        answer:
          "OTP verification confirms that the email belongs to the person or clinic registering. It helps reduce fake signups and makes account recovery safer.",
      },
      {
        question: "What password is required?",
        answer:
          "Patient and clinic signup forms require a strong password with at least 8 characters, uppercase and lowercase letters, a number, and a special character.",
      },
      {
        question: "What should I do if login fails?",
        answer:
          "Check that the email or clinic ID and password are correct. If the password is forgotten, use the Forgot password link on the login page and complete the OTP reset flow.",
      },
      {
        question: "Is Krama a replacement for medical advice?",
        answer:
          "No. Krama helps with clinic discovery, appointments, queue management, and visit flow. Medical advice, diagnosis, prescriptions, and treatment decisions come from qualified healthcare providers.",
      },
      {
        question: "How can someone contact Krama?",
        answer:
          "Visitors can use the Feedback page from the website footer or contact Krama support through the support email listed on the site.",
      },
    ],
  },
];

const quickLinks = [
  { label: "Patient Login", to: "/patient/login", icon: LogIn },
  { label: "Patient Signup", to: "/patient/signup", icon: UserRound },
  { label: "Clinic Login", to: "/clinic/login", icon: Building2 },
  { label: "Clinic Registration", to: "/clinic/register", icon: CalendarCheck },
];

const highlights = [
  {
    icon: Ticket,
    title: "Digital Tokens",
    copy: "Patients get clearer appointment and queue visibility.",
  },
  {
    icon: MapPin,
    title: "Nearby Clinics",
    copy: "Search by location, clinic, doctor, address, or specialization.",
  },
  {
    icon: ShieldCheck,
    title: "Verified Signup",
    copy: "Email OTP verification protects patient and clinic accounts.",
  },
];

const FAQ = () => {
  return (
    <main className="min-h-screen">
      <section className="section-container px-4 pb-12 pt-10 md:px-8 md:pb-16 md:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-white/80 px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <HelpCircle className="h-4 w-4 text-accent" />
              Krama help centre
            </div>

            <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight text-foreground md:text-6xl">
              Frequently asked questions about Krama.
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Clear answers for patients and clinics: what Krama does, how login works, how appointment booking works,
              and how clinics manage live queues.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {quickLinks.map(({ label, to, icon: Icon }) => (
                <Link
                  key={label}
                  to={to}
                  className="flex items-center justify-between rounded-[18px] border border-border/70 bg-white/80 px-4 py-3 text-sm font-medium text-foreground shadow-sm transition hover:border-primary/40 hover:bg-white"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </span>
                    {label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[32px] p-6 md:p-8">
            <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">At a glance</p>
            <div className="mt-6 space-y-4">
              {highlights.map(({ icon: Icon, title, copy }) => (
                <div key={title} className="rounded-[22px] border border-border/70 bg-white/80 p-5">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-secondary p-3">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">{title}</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-secondary/45 py-12 md:py-16">
        <div className="section-container px-4 md:px-8">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <aside className="h-fit rounded-[24px] border border-border/70 bg-white/80 p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">Topics</p>
              <nav className="mt-4 space-y-2 text-sm" aria-label="FAQ topics">
                {faqSections.map((section) => (
                  <a
                    key={section.title}
                    href={`#${section.title.toLowerCase().replaceAll(" ", "-")}`}
                    className="block rounded-xl px-3 py-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <div className="space-y-6">
              {faqSections.map((section) => (
                <section
                  key={section.title}
                  id={section.title.toLowerCase().replaceAll(" ", "-")}
                  className="rounded-[28px] border border-border/70 bg-white/85 p-6 shadow-sm md:p-8"
                >
                  <div className="mb-5">
                    <h2 className="font-display text-2xl font-bold text-foreground">{section.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.description}</p>
                  </div>

                  <Accordion type="single" collapsible className="space-y-3">
                    {section.items.map((item) => (
                      <AccordionItem
                        key={item.question}
                        value={item.question}
                        className="rounded-[18px] border border-border/70 bg-background/70 px-4"
                      >
                        <AccordionTrigger className="py-4 text-left text-base font-semibold hover:no-underline">
                          {item.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-sm leading-7 text-muted-foreground">
                          {item.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-container px-4 py-14 md:px-8 md:py-16">
        <div className="rounded-[32px] bg-foreground px-6 py-10 text-center text-white shadow-[0_28px_80px_-42px_rgba(10,30,26,0.9)] md:px-10">
          <p className="text-sm uppercase tracking-[0.28em] text-white/55">Still need help?</p>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-bold leading-tight">
            Send feedback or start from the right login page.
          </h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/feedback">
              <Button size="lg" variant="secondary">
                Send Feedback
              </Button>
            </Link>
            <Link to="/patient/login">
              <Button size="lg" variant="outline" className="border-white/25 bg-white/5 text-white hover:bg-white/10">
                Patient Login
              </Button>
            </Link>
            <Link to="/clinic/login">
              <Button size="lg" variant="outline" className="border-white/25 bg-white/5 text-white hover:bg-white/10">
                Clinic Login
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default FAQ;
