const localPreviewApiBaseUrl = () => {
  if (typeof window === "undefined") return "";
  const { hostname, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  return isLocalHost && port === "8081" ? "http://127.0.0.1:8082" : "";
};

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || localPreviewApiBaseUrl();

const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");

export const apiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
};
