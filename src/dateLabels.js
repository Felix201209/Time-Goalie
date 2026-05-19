export function getClockLabel(date) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getDateLabel(date) {
  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

export function getSelectedDateLabel(value) {
  const [, month, day] = value.split("-");
  return month && day ? `${month}/${day}` : value;
}
