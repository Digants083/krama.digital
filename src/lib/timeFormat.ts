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
