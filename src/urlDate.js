import { createEmptyDay, isISODate } from "./storage.js";

const DATE_QUERY_KEY = "date";

export function getDateFromURL() {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get(DATE_QUERY_KEY);
  return isISODate(value) ? value : null;
}

export function applyDateFromURL(plan) {
  const selectedDate = getDateFromURL();
  if (!selectedDate) return plan;
  return {
    ...plan,
    selectedDate,
    days: {
      ...plan.days,
      [selectedDate]: plan.days?.[selectedDate] || createEmptyDay(),
    },
  };
}

export function syncDateToURL(selectedDate) {
  if (typeof window === "undefined" || !isISODate(selectedDate)) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(DATE_QUERY_KEY) === selectedDate) return;
  url.searchParams.set(DATE_QUERY_KEY, selectedDate);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
