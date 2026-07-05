import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SITE_URL = "https://krama.digital";
const DEFAULT_IMAGE = `${SITE_URL}/digi-logo-v2.png`;

type SeoConfig = {
  title: string;
  description: string;
  keywords?: string;
  canonicalPath?: string;
  index?: boolean;
};

const searchIntentSeo: Record<string, SeoConfig> = {
  "/find-clinics-near-me": {
    title: "Find Clinics Near Me - Krama",
    description:
      "Find clinics near you with Krama, book appointments, join digital queues, and track your clinic token live from your phone.",
    keywords:
      "find clinics near me, online doctor appointment system, appointment booking system, medical appointment scheduler, doctor appointment software",
    canonicalPath: "/find-clinics-near-me",
  },
  "/queue-management": {
    title: "Clinic Queue Management System - Krama",
    description:
      "Krama is clinic management software for queue management, appointments, digital tokens, OPD patient flow, and live patient status updates.",
    keywords:
      "clinic management software, clinic management system, queue management system for clinics, patient queue management software, clinic token system, clinic automation software",
    canonicalPath: "/queue-management",
  },
  "/control-queue": {
    title: "Control Queue Digitally - Krama",
    description:
      "Control clinic queues digitally with Krama. Move, skip, and update patient tokens while keeping waiting patients informed.",
    keywords:
      "patient queue management software, reception management software for clinics, clinic workflow automation, patient management software, doctor dashboard software",
    canonicalPath: "/control-queue",
  },
  "/digital-token-system": {
    title: "Digital Token System for Clinics - Krama",
    description:
      "Use Krama as a digital token system for clinics and diagnostic centres with online tokens, live queue tracking, and appointment flow.",
    keywords:
      "clinic token system, digital token system, hospital queue management system, patient queue management software, queue management system for clinics",
    canonicalPath: "/digital-token-system",
  },
  "/manage-queue-in-clinic": {
    title: "Manage Clinic Queue and Appointments - Krama",
    description:
      "Learn how Krama helps clinics manage appointments, patient queues, time slots, digital tokens, walk-ins, and live queue controls.",
    keywords:
      "clinic appointment management, clinic administration software, patient registration software, medical office software, software for small clinics",
    canonicalPath: "/manage-queue-in-clinic",
  },
  "/reduce-patient-waiting-time": {
    title: "Reduce Patient Waiting Time - Krama",
    description:
      "Reduce clinic waiting time with Krama through live queue visibility, appointment slots, digital tokens, and patient status updates.",
    keywords:
      "patient management software, outpatient management system, OPD management software, clinic workflow automation, healthcare management software",
    canonicalPath: "/reduce-patient-waiting-time",
  },
  "/hospital-queue-management": {
    title: "Hospital Queue Management System - Krama",
    description:
      "Krama supports hospital-style OPD and clinic queue management with digital tokens, walk-ins, time slots, and live patient status.",
    keywords:
      "hospital management software, hospital queue management system, hospital ERP software, hospital software India, outpatient management system",
    canonicalPath: "/hospital-queue-management",
  },
  "/opd-queue-management": {
    title: "OPD Management Software - Krama",
    description:
      "Manage OPD queues with Krama using appointment slots, digital tokens, QR walk-in flow, and live queue controls.",
    keywords:
      "OPD management software, outpatient management system, doctor patient management system, patient history management system, clinic token system",
    canonicalPath: "/opd-queue-management",
  },
  "/clinic-waiting-room-management": {
    title: "Clinic Waiting Room Management - Krama",
    description:
      "Manage crowded clinic waiting rooms with Krama by giving patients live queue status, digital tokens, and clearer visit timing.",
    keywords:
      "clinic workflow automation, reception management software for clinics, patient queue management software, clinic automation software",
    canonicalPath: "/clinic-waiting-room-management",
  },
  "/qr-code-queue-system": {
    title: "QR Code Queue System for Clinics - Krama",
    description:
      "Let walk-in patients scan a clinic QR link, join the queue, choose an available slot, and receive a digital token with Krama.",
    keywords:
      "clinic token system, QR code queue system, patient registration software, appointment booking system, digital clinic platform",
    canonicalPath: "/qr-code-queue-system",
  },
  "/doctor-appointment-system": {
    title: "Doctor Appointment Software - Krama",
    description:
      "Krama combines doctor appointment booking, time slots, clinic queues, and digital token tracking in one healthcare flow.",
    keywords:
      "doctor appointment software, doctor scheduling software, online doctor appointment system, medical appointment scheduler, appointment booking system",
    canonicalPath: "/doctor-appointment-system",
  },
  "/walk-in-patient-management": {
    title: "Walk-In Patient Management - Krama",
    description:
      "Manage walk-in patients with Krama using QR queue joining, quick booking, digital tokens, and live clinic queue controls.",
    keywords:
      "patient management software, patient registration software, doctor patient management system, clinic token system, clinic workflow automation",
    canonicalPath: "/walk-in-patient-management",
  },
};

const seoByPath: Record<string, SeoConfig> = {
  "/": {
    title: "Krama - Clinic Management Software and Queue System India",
    description:
      "Krama is clinic management software for India with doctor appointments, patient queue management, digital tokens, OPD flow, and live clinic dashboards.",
    keywords:
      "clinic management software, clinic management system, hospital management software, patient management software, doctor appointment software, medical practice management software, appointment booking system, online doctor appointment system, digital prescription software, electronic medical records software, EMR software, EHR software, queue management system for clinics, patient queue management software, doctor scheduling software, clinic appointment management, clinic administration software, healthcare management software, medical records management system, doctor clinic software, software for clinics, software for small clinics, dental clinic management software, physiotherapy clinic software, skin clinic management software, multi clinic management software, cloud based clinic management software, AI clinic management software, best clinic software in India, hospital ERP software, doctor patient management system, clinic CRM software, outpatient management system, OPD management software, clinic automation software, smart clinic software, digital healthcare platform, doctor dashboard software, reception management software for clinics, prescription management system, patient registration software, medical appointment scheduler, healthcare SaaS platform, medical office software, clinic workflow automation, clinic inventory management software, medical data management system, best software for doctors, best software for clinics, clinic software Bangalore, clinic software India, hospital software India, doctor management software, patient history management system, clinic token system, hospital queue management system, digital clinic platform",
    canonicalPath: "/",
  },
  "/about": {
    title: "About Krama - Digital Healthcare and Clinic Management Platform",
    description:
      "Learn how Krama helps clinics manage appointments, patients, tokens, OPD queues, and waiting rooms while giving patients real-time visit visibility.",
    keywords:
      "healthcare management software, digital healthcare platform, smart clinic software, clinic automation software, software for clinics",
    canonicalPath: "/about",
  },
  "/feedback": {
    title: "Feedback - Krama",
    description:
      "Share feedback with Krama to help improve digital queue management, clinic appointments, and patient experience.",
    canonicalPath: "/feedback",
  },
  "/faq": {
    title: "FAQ - Krama Digital Queue and Appointment Help",
    description:
      "Find answers about Krama, patient login, clinic login, appointment booking, digital tokens, live queue tracking, clinic registration, and queue management.",
    keywords:
      "clinic management software FAQ, patient management software, clinic login, patient login, doctor appointment software, queue management system for clinics",
    canonicalPath: "/faq",
  },
  "/patient/signup": {
    title: "Patient Signup - Krama",
    description:
      "Create a Krama patient account to find clinics, book appointments, join digital queues, and track your token live.",
    keywords:
      "patient registration software, online doctor appointment system, appointment booking system, medical appointment scheduler",
    canonicalPath: "/patient/signup",
  },
  "/clinic/register": {
    title: "Register Clinic - Clinic Management Software by Krama",
    description:
      "Register your clinic on Krama to manage doctors, time slots, appointments, patient queues, digital tokens, and clinic workflow automation.",
    keywords:
      "clinic management software, software for clinics, software for small clinics, doctor clinic software, clinic appointment management, doctor scheduling software",
    canonicalPath: "/clinic/register",
  },
  ...searchIntentSeo,
};

const indexablePaths = new Set(Object.keys(seoByPath));

const noIndexPrefixes = [
  "/admin",
  "/book",
  "/clinic",
  "/clinic-details",
  "/confirmation",
  "/doctor-dashboard",
  "/join",
  "/live",
  "/patient",
  "/walkin",
  "/your-token",
];

const noIndexExactPaths = new Set([
  "/clinic/login",
  "/clinic/forgot-password",
  "/clinic/verify-reset-otp",
  "/clinic/reset-password",
  "/clinic/register/success",
  "/patient/login",
  "/patient/verify-otp",
  "/patient/forgot-password",
  "/patient/verify-reset-otp",
  "/patient/reset-password",
  "/your-details",
]);

const ensureMeta = (selector: string, create: () => HTMLMetaElement) => {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    return existing;
  }

  const meta = create();
  document.head.appendChild(meta);
  return meta;
};

const setMetaName = (name: string, content: string) => {
  const meta = ensureMeta(`meta[name="${name}"]`, () => {
    const element = document.createElement("meta");
    element.setAttribute("name", name);
    return element;
  });
  meta.setAttribute("content", content);
};

const setMetaProperty = (property: string, content: string) => {
  const meta = ensureMeta(`meta[property="${property}"]`, () => {
    const element = document.createElement("meta");
    element.setAttribute("property", property);
    return element;
  });
  meta.setAttribute("content", content);
};

const setCanonical = (href: string) => {
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", href);
};

const isNoIndexPath = (pathname: string) => {
  if (indexablePaths.has(pathname)) {
    return false;
  }

  if (noIndexExactPaths.has(pathname)) {
    return true;
  }

  return noIndexPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
};

const getSeoConfig = (pathname: string): SeoConfig => {
  const config = seoByPath[pathname];

  if (config) {
    return config;
  }

  return {
    title: "Krama",
    description:
      "Krama is a smart digital token and queue management system for clinics, diagnostic centres, and patients.",
    keywords:
      "clinic management software, clinic management system, patient management software, doctor appointment software, queue management system for clinics",
    canonicalPath: pathname,
    index: !isNoIndexPath(pathname),
  };
};

const SeoManager = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const seo = getSeoConfig(pathname);
    const canonicalUrl = `${SITE_URL}${seo.canonicalPath || pathname}`;
    const robots = seo.index === false || isNoIndexPath(pathname) ? "noindex, nofollow" : "index, follow";

    document.title = seo.title;
    setCanonical(canonicalUrl);
    setMetaName("description", seo.description);
    setMetaName("keywords", seo.keywords || "");
    setMetaName("robots", robots);

    setMetaProperty("og:site_name", "Krama");
    setMetaProperty("og:title", seo.title);
    setMetaProperty("og:description", seo.description);
    setMetaProperty("og:type", "website");
    setMetaProperty("og:url", canonicalUrl);
    setMetaProperty("og:image", DEFAULT_IMAGE);
    setMetaProperty("og:image:secure_url", DEFAULT_IMAGE);
    setMetaProperty("og:image:type", "image/png");
    setMetaProperty("og:image:width", "512");
    setMetaProperty("og:image:height", "512");
    setMetaProperty("og:image:alt", "Krama logo and smart digital queue branding");

    setMetaName("twitter:card", "summary_large_image");
    setMetaName("twitter:title", seo.title);
    setMetaName("twitter:description", seo.description);
    setMetaName("twitter:image", DEFAULT_IMAGE);
    setMetaName("twitter:image:alt", "Krama logo and smart digital queue branding");
  }, [pathname]);

  return null;
};

export default SeoManager;
