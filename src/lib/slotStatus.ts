export type SlotState = "open" | "close" | string | null | undefined;

export type SlotLike = {
  is_open?: boolean | string | number | null;
};

export type PatientSlotDisplayStatus = "Available" | "Ongoing" | "Delayed" | "Expired" | "Closed" | "Not Available";

export type PatientSlotStatus = {
  is_open: boolean;
  is_expired: boolean;
  display_status: PatientSlotDisplayStatus;
  clock_expired: boolean;
};

const DAY_MINUTES = 24 * 60;
const SELECTABLE_STATUSES = new Set(["Available", "Ongoing", "Delayed"]);

const toMinutes = (hourDecimal: number) => Math.round(hourDecimal * 60);

function normalizeSessionStatus(status?: string | null): PatientSlotDisplayStatus | null {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "available" || normalized === "open") return "Available";
  if (normalized === "ongoing" || normalized === "started" || normalized === "active") return "Ongoing";
  if (normalized === "delayed" || normalized === "paused") return "Delayed";
  if (normalized === "expired") return "Expired";
  if (normalized === "closed" || normalized === "close") return "Closed";
  if (normalized === "not available" || normalized === "unavailable") return "Not Available";
  return null;
}

export function hasSlotExpiredByClock(timeRange?: number[], now: Date = new Date(), cutoffMinutes = 15): boolean {
  if (!Array.isArray(timeRange) || timeRange.length < 2) return false;

  const startMinutes = toMinutes(Number(timeRange[0] || 0));
  const rawEndMinutes = toMinutes(Number(timeRange[1] || 0));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (rawEndMinutes > DAY_MINUTES) {
    const nextDayCutoff = rawEndMinutes - DAY_MINUTES - cutoffMinutes;
    const isBeforeTodayStart = currentMinutes < startMinutes;
    return isBeforeTodayStart && currentMinutes >= Math.max(nextDayCutoff, 0);
  }

  if (currentMinutes < startMinutes) return false;
  return currentMinutes >= rawEndMinutes - cutoffMinutes;
}

export function isSlotManuallyOpen(slot: SlotLike, slotStates: SlotState[], index: number): boolean {
  const state = String(slotStates[index] ?? "").toLowerCase();
  if (state === "close" || state === "closed") return false;
  if (state === "open") return true;

  if (typeof slot?.is_open === "string") {
    return slot.is_open.toLowerCase() === "true" || slot.is_open.toLowerCase() === "open";
  }

  return Boolean(slot?.is_open);
}

export function getPatientSlotStatus(
  timeRange: number[] | undefined,
  isOpen: boolean,
  now: Date = new Date(),
  sessionStatus?: string | null,
): PatientSlotStatus {
  const clockExpired = hasSlotExpiredByClock(timeRange, now);
  const canonicalStatus = normalizeSessionStatus(sessionStatus);

  if (canonicalStatus) {
    return {
      is_open: SELECTABLE_STATUSES.has(canonicalStatus),
      is_expired: canonicalStatus === "Expired",
      display_status: canonicalStatus,
      clock_expired: clockExpired,
    };
  }

  if (!isOpen) {
    return {
      is_open: false,
      is_expired: false,
      display_status: "Not Available",
      clock_expired: clockExpired,
    };
  }

  if (clockExpired) {
    return {
      is_open: false,
      is_expired: true,
      display_status: "Expired",
      clock_expired: true,
    };
  }

  return {
    is_open: true,
    is_expired: false,
    display_status: "Available",
    clock_expired: false,
  };
}