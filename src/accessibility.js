export function compactAccessibleName(value, fallback = "未命名时间块") {
  const text = String(value || "").trim() || fallback;
  return text.length > 36 ? `${text.slice(0, 34)}…` : text;
}
