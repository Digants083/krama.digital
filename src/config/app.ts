export const APP_NAME = import.meta.env.VITE_APP_NAME?.trim() || "Krama";
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "support@krama.in";

export const ADMIN_EMAIL_LABELS: Record<string, string> = {
  admin1: import.meta.env.VITE_ADMIN1_EMAIL_LABEL?.trim() || "configured admin inbox",
  admin2: import.meta.env.VITE_ADMIN2_EMAIL_LABEL?.trim() || "configured admin inbox",
};

export const ADMIN_CONFIRMATION_EMAIL_LABELS: Record<string, string> = {
  admin1: import.meta.env.VITE_ADMIN1_CONFIRMATION_EMAIL_LABEL?.trim() || ADMIN_EMAIL_LABELS.admin1,
  admin2: import.meta.env.VITE_ADMIN2_CONFIRMATION_EMAIL_LABEL?.trim() || "configured confirmation inbox",
};
