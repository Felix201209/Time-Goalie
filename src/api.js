export const API_BASE = "/api";

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `HTTP ${response.status}`);
  return payload;
}

export function getWorkflows() {
  return api("/workflows");
}

export function parseInboxText({ text, selectedDate, plan }) {
  return api("/ai/parse", {
    method: "POST",
    body: JSON.stringify({ text, selectedDate, plan }),
  });
}

export function syncPlan(plan) {
  return api("/plan/sync", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

export function getSettings() {
  return api("/settings");
}

export function getSetup() {
  return api("/setup");
}

export function saveSetup(setup) {
  return api("/setup", {
    method: "PUT",
    body: JSON.stringify({ setup }),
  });
}

export function putSettings(settings) {
  return api("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
}

export function scheduleReminders({ plan, date }) {
  return api("/reminders/schedule", {
    method: "POST",
    body: JSON.stringify({ plan, date }),
  });
}

export function testReminder(channel) {
  return api("/reminders/test", {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
}

export function recoverReminders(action) {
  return api("/reminders/recover", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export function schedulerStatus() {
  return api("/scheduler/status");
}

export function subscribePush(subscription) {
  return api("/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function exportIcs(plan, date) {
  const response = await fetch(`${API_BASE}/export/ics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, date }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.blob();
}
