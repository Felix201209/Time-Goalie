import http from "node:http";
import {
  DEFAULT_DATA_FILE,
  DEFAULT_ENV_FILE,
  WORKFLOW_CHAINS,
  applyEnvToSettings,
  createEmptyStore,
  createIcs,
  deliverDueReminders,
  getSetupStatus,
  loadLocalEnv,
  mergeReminders,
  normalizeSettings,
  parseWithAI,
  publicSettings,
  readStore,
  scheduleFromPlan,
  saveSetupConfig,
  sendBark,
  sendWebPush,
  writeStore,
} from "./lib/core.mjs";

const ENV_FILE = process.env.TIME_GOALIE_ENV_FILE || DEFAULT_ENV_FILE;

await loadLocalEnv(ENV_FILE);
const PORT = Number(process.env.SERVER_PORT || 8787);
const DATA_FILE = process.env.TIME_GOALIE_DATA_FILE || DEFAULT_DATA_FILE;
let store = await readStore(DATA_FILE).catch(() => createEmptyStore());
store.settings = applyEnvToSettings(normalizeSettings(store.settings));
await writeStore(store, DATA_FILE);

async function persist() {
  store = await writeStore(store, DATA_FILE);
  return store;
}

async function json(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type":
      typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  });
  response.end(body);
}

function routeError(response, error) {
  send(response, 500, { error: error.message || "Server error" });
}

function barkDiagnostics() {
  const recent = store.deliveryLog
    .filter((item) => item.channel === "bark")
    .slice(-6)
    .reverse();
  return {
    enabled: Boolean(store.settings.channels?.bark),
    configured: Boolean(store.settings.bark?.key),
    server: store.settings.bark?.server,
    level: store.settings.bark?.level,
    sound: store.settings.bark?.sound || "",
    archive: store.settings.bark?.archive !== false,
    recentFailures: recent.filter((item) => item.status === "failed").length,
    last: recent[0] || null,
  };
}

async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "OPTIONS") return send(response, 204, "");

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return send(response, 200, { ok: true, scheduler: "running", updatedAt: store.updatedAt });
    }

    if (request.method === "GET" && url.pathname === "/api/workflows") {
      return send(response, 200, { workflows: WORKFLOW_CHAINS });
    }

    if (request.method === "POST" && url.pathname === "/api/ai/parse") {
      const body = await json(request);
      const text = String(body.text || "").slice(0, 12000);
      const selectedDate = body.selectedDate || body.date || store.planMirror?.selectedDate;
      const result = await parseWithAI({ text, selectedDate, settings: store.settings });
      const inboxItem = {
        id: result.draft.id,
        source: "quick-input",
        text,
        status: "parsed",
        createdAt: new Date().toISOString(),
        warning: result.warning || "",
      };
      store.inbox = [...store.inbox, inboxItem].slice(-80);
      await persist();
      return send(response, 200, { ...result, inboxItem });
    }

    if (request.method === "POST" && url.pathname === "/api/plan/sync") {
      const body = await json(request);
      store.planMirror = body.plan || body;
      await persist();
      return send(response, 200, { ok: true, updatedAt: store.updatedAt });
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      return send(response, 200, { settings: publicSettings(store.settings) });
    }

    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const body = await json(request);
      const incoming = body.settings || body;
      store.settings = normalizeSettings({
        ...store.settings,
        ...incoming,
        channels: { ...store.settings.channels, ...(incoming.channels || {}) },
        bark: { ...store.settings.bark, ...(incoming.bark || {}) },
        webPush: { ...store.settings.webPush, ...(incoming.webPush || {}) },
        quietHours: { ...store.settings.quietHours, ...(incoming.quietHours || {}) },
        ai: { ...store.settings.ai, ...(incoming.ai || {}) },
      });
      await persist();
      return send(response, 200, { settings: publicSettings(store.settings) });
    }

    if (request.method === "GET" && url.pathname === "/api/setup") {
      return send(response, 200, { setup: await getSetupStatus(store, ENV_FILE) });
    }

    if (request.method === "PUT" && url.pathname === "/api/setup") {
      const body = await json(request);
      store = await saveSetupConfig(store, body.setup || body, ENV_FILE);
      await persist();
      return send(response, 200, { setup: await getSetupStatus(store, ENV_FILE) });
    }

    if (request.method === "POST" && url.pathname === "/api/push/subscribe") {
      const body = await json(request);
      if (!body.subscription?.endpoint)
        return send(response, 400, { error: "subscription.endpoint required" });
      store.pushSubscriptions = [
        ...store.pushSubscriptions.filter(
          (subscription) => subscription.endpoint !== body.subscription.endpoint,
        ),
        body.subscription,
      ];
      await persist();
      return send(response, 200, { ok: true, count: store.pushSubscriptions.length });
    }

    if (request.method === "POST" && url.pathname === "/api/reminders/schedule") {
      const body = await json(request);
      const plan = body.plan || store.planMirror;
      if (!plan) return send(response, 400, { error: "plan required" });
      store.planMirror = plan;
      const reminders = scheduleFromPlan(plan, store.settings, body.date || plan.selectedDate);
      store.reminders = mergeReminders(store.reminders, reminders);
      await persist();
      return send(response, 200, { ok: true, scheduled: reminders.length, reminders: store.reminders });
    }

    if (request.method === "POST" && url.pathname === "/api/reminders/test") {
      const body = await json(request);
      const channel =
        body.channel ||
        (store.settings.channels.bark ? "bark" : store.settings.channels.webPush ? "webPush" : "inApp");
      const reminder = {
        id: `test-${Date.now()}`,
        title: "Time Goalie 测试提醒",
        body: "如果你看到了这条消息，闭环通知已经接通。",
        channel,
      };
      try {
        if (channel === "bark") await sendBark(store.settings.bark, reminder.title, reminder.body);
        if (channel === "webPush") await sendWebPush(store.settings, store.pushSubscriptions, reminder);
        store.deliveryLog = [
          ...store.deliveryLog,
          {
            id: `${reminder.id}:manual`,
            reminderId: reminder.id,
            channel,
            status: "delivered",
            message: "manual test delivered",
            at: new Date().toISOString(),
          },
        ].slice(-160);
        await persist();
        return send(response, 200, { ok: true, channel, bark: barkDiagnostics() });
      } catch (error) {
        store.deliveryLog = [
          ...store.deliveryLog,
          {
            id: `${reminder.id}:manual`,
            reminderId: reminder.id,
            channel,
            status: "failed",
            message: error.message,
            at: new Date().toISOString(),
          },
        ].slice(-160);
        await persist();
        return send(response, channel === "bark" ? 400 : 500, {
          ok: false,
          channel,
          error: error.message,
          bark: barkDiagnostics(),
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/scheduler/status") {
      const pending = store.reminders.filter((reminder) => reminder.status === "pending").length;
      const failed = store.reminders.filter((reminder) => reminder.status === "failed").length;
      const delivered = store.reminders.filter((reminder) => reminder.status === "delivered").length;
      return send(response, 200, {
        ok: true,
        pending,
        failed,
        delivered,
        subscriptions: store.pushSubscriptions.length,
        bark: barkDiagnostics(),
        lastDeliveries: store.deliveryLog.slice(-8).reverse(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/export/ics") {
      const body = await json(request);
      const plan = body.plan || store.planMirror;
      if (!plan) return send(response, 400, { error: "plan required" });
      const ics = createIcs(plan, body.date || plan.selectedDate);
      return send(response, 200, ics, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="time-goalie-${body.date || plan.selectedDate}.ics"`,
      });
    }

    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return routeError(response, error);
  }
}

const server = http.createServer(handler);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Time Goalie server listening on http://127.0.0.1:${PORT}`);
});

setInterval(async () => {
  try {
    const result = await deliverDueReminders(store);
    if (result.due > 0) await persist();
  } catch (error) {
    console.error("scheduler error", error);
  }
}, 30_000);
