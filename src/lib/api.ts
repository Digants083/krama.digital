const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || "";

const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");

export const apiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
};
