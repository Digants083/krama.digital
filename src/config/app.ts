export const APP_NAME = import.meta.env.VITE_APP_NAME?.trim() || "Krama";
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "support@krama.in";

export const ADMIN_EMAIL_LABELS: Record<string, string> = {
  admin1: import.meta.env.VITE_ADMIN1_EMAIL_LABEL?.trim() || "diganths083@gmail.com",
};

export const ADMIN_CONFIRMATION_EMAIL_LABELS: Record<string, string> = {
  admin1: import.meta.env.VITE_ADMIN1_CONFIRMATION_EMAIL_LABEL?.trim() || "digitalkrama@gmail.com",
};
