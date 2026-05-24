import http from "node:http";
import {
  buildStaleSnapshotEvent,
  configFromEnv,
  createEventsFromSnapshot,
  deliverDueEvents,
  mergeEvents,
  readJson,
  statusPayload,
  writeJson,
} from "./lib/homework.mjs";

const config = configFromEnv();
let state = await readJson(config.dataFile);
state.updatedAt = state.updatedAt || new Date().toISOString();
await persist();

async function persist() {
  state.updatedAt = new Date().toISOString();
  await writeJson(config.dataFile, state);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response, status, payload) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  response.writeHead(status, {
    "content-type":
      typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
  });
  response.end(body);
}

function isAuthorized(request) {
  if (!config.syncToken) return true;
  return request.headers.authorization === `Bearer ${config.syncToken}`;
}

async function handler(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      return send(response, 200, statusPayload(state, config));
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return send(response, 200, {
        ...statusPayload(state, config),
        lastDeliveries: state.deliveryLog.slice(-12).reverse(),
        rescuePackets: (state.events || [])
          .filter((event) => event.rescuePacket)
          .slice(-10)
          .map((event) => event.rescuePacket),
      });
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      if (!isAuthorized(request)) return send(response, 401, { error: "unauthorized" });
      const body = await readBody(request);
      const snapshot = body.snapshot || body;
      if (!Array.isArray(snapshot.assignments))
        return send(response, 400, { error: "snapshot.assignments required" });
      const now = new Date();
      state.snapshot = snapshot;
      state.lastScanAt = snapshot.generatedAt || now.toISOString();
      state.events = mergeEvents(
        state.events.filter((event) => event.kind !== "stale-snapshot"),
        createEventsFromSnapshot(snapshot, config, now),
      );
      await persist();
      return send(response, 200, { ok: true, status: statusPayload(state, config) });
    }

    if (request.method === "POST" && url.pathname === "/bark/test") {
      if (!isAuthorized(request)) return send(response, 401, { error: "unauthorized" });
      state.events = mergeEvents(state.events, [
        {
          id: `test:${Date.now()}`,
          assignmentId: null,
          kind: "test",
          riskLevel: "watch",
          fireAt: new Date().toISOString(),
          title: "Homework Goalie 测试",
          body: "树莓派 Bark 服务已连接。",
          status: "pending",
          retryCount: 0,
          lastError: "",
        },
      ]);
      await deliverAndPersist();
      return send(response, 200, { ok: true, status: statusPayload(state, config) });
    }

    if (request.method === "POST" && url.pathname === "/events/ack") {
      if (!isAuthorized(request)) return send(response, 401, { error: "unauthorized" });
      const body = await readBody(request);
      const ids = new Set(Array.isArray(body.ids) ? body.ids : [body.id].filter(Boolean));
      for (const event of state.events) {
        if (ids.has(event.id)) event.status = "acknowledged";
      }
      state.acknowledgements.push({ ids: [...ids], at: new Date().toISOString(), note: body.note || "" });
      state.acknowledgements = state.acknowledgements.slice(-80);
      await persist();
      return send(response, 200, { ok: true, status: statusPayload(state, config) });
    }

    return send(response, 404, { error: "not found" });
  } catch (error) {
    return send(response, 500, { error: error.message || "server error" });
  }
}

async function deliverAndPersist() {
  const staleEvent = buildStaleSnapshotEvent(state);
  if (staleEvent) state.events = mergeEvents(state.events, [staleEvent]);
  await deliverDueEvents(state, config);
  await persist();
}

const server = http.createServer(handler);
server.listen(config.port, config.host, () => {
  console.log(`Homework Goalie listening on http://${config.host}:${config.port}`);
});

setInterval(() => {
  deliverAndPersist().catch((error) => console.error("scheduler error", error));
}, 30_000).unref();
