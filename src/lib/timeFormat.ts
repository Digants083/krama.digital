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
  if (minutes === 60) return "1 hour";
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} min`;
};
