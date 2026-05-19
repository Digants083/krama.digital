export const formatHourDecimal = (value: number) => {
  const totalMinutesRaw = Math.round(value * 60);
  const dayMinutes = 24 * 60;
  const totalMinutes = ((totalMinutesRaw % dayMinutes) + dayMinutes) % dayMinutes;
  const hour24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? "PM" : "AM";

  return `${hour12}:${String(minutes).padStart(2, "0")} ${ampm}`;
};

export const formatHourDecimal24 = (value: number) => {
  const totalMinutesRaw = Math.round(value * 60);
  const dayMinutes = 24 * 60;
  const totalMinutes = ((totalMinutesRaw % dayMinutes) + dayMinutes) % dayMinutes;
  const hour24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hour24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export const formatTimeRange = (timeRange: number[]) => {
  if (!Array.isArray(timeRange) || timeRange.length < 2) return "";
  return `${formatHourDecimal(timeRange[0])} - ${formatHourDecimal(timeRange[1])}`;
};

export const formatIsoClock = (isoDate?: string | null) => {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

export const delayMinutesToHours = (delayMinutes?: number | null) => {
  const minutes = Number(delayMinutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes / 60 : 0;
};

export const formatDelayedTimeRange = (timeRange: number[], delayMinutes?: number | null) => {
  const delayHours = delayMinutesToHours(delayMinutes);
  if (!delayHours) return formatTimeRange(timeRange);
  if (!Array.isArray(timeRange) || timeRange.length < 2) return "";
  return formatTimeRange([timeRange[0] + delayHours, timeRange[1] + delayHours]);
};

export const formatDelayedStartTime = (timeRange: number[], delayMinutes?: number | null) => {
  const delayHours = delayMinutesToHours(delayMinutes);
  if (!Array.isArray(timeRange) || timeRange.length < 1) return "";
  return formatHourDecimal(timeRange[0] + delayHours);
};

export const formatDelayLabel = (delayMinutes?: number | null) => {
  const minutes = Number(delayMinutes || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  return formatDurationMinutes(minutes);
};

export const formatDurationMinutes = (value?: number | null) => {
  const totalMinutes = Math.max(0, Math.ceil(Number(value || 0)));
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  const hourText = `${hours} ${hours === 1 ? "hr" : "hrs"}`;
  return minutes > 0 ? `${hourText} ${minutes} min` : hourText;
};

export const formatCountdown = (seconds?: number | null) => {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export const secondsUntil = (isoDate?: string | null) => {
  if (!isoDate) return 0;
  const target = new Date(isoDate).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.floor((target - Date.now()) / 1000));
};
