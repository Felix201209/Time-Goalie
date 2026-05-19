import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";

export const DEFAULT_DATA_FILE = path.join(process.cwd(), "server", "data", "time-goalie.json");
export const DEFAULT_ENV_FILE = path.join(process.cwd(), ".env.local");

export const WORKFLOW_CHAINS = [
  { id: "messy-input", title: "混乱输入生成今日计划", action: "把一段乱输入整理成目标、时间块和提醒" },
  { id: "markdown-extract", title: "长文本 / Markdown 提取", action: "从笔记里抽任务、时间和复盘问题" },
  { id: "auto-schedule", title: "一键智能排期", action: "自动避开冲突并填入今日空档" },
  { id: "bark-guard", title: "Bark 守门提醒", action: "提前、开始、超时都能推到手机" },
  { id: "web-push", title: "Web Push 兜底", action: "PWA/浏览器也能收到提醒" },
  { id: "focus-guard", title: "当前块 Focus 守门", action: "开始倒计时，结束后立刻复盘" },
  { id: "missed-rescue", title: "错过任务自动救援", action: "检测错过块并生成重排建议" },
  { id: "morning-brief", title: "每日早间 Brief", action: "早上自动推送今日防线" },
  { id: "evening-review", title: "晚间 Review", action: "总结完成率、拖延项和下一步" },
  { id: "carry-over", title: "明日 Carry-over", action: "未完成任务变成明日草稿" },
  { id: "template-library", title: "模板库", action: "学习、项目、运动、考试、创作、杂务快速套用" },
  { id: "export-loop", title: "导出闭环", action: "Markdown、JSON、ICS 都能带走" },
];

export const DEFAULT_SETTINGS = {
  channels: {
    bark: false,
    webPush: false,
    inApp: true,
  },
  bark: {
    key: "",
    server: "https://api.day.app",
    level: "timeSensitive",
    sound: "",
    archive: true,
  },
  webPush: {
    publicKey: "",
    privateKey: "",
  },
  reminderLeadMinutes: [10, 0],
  quietHours: {
    enabled: false,
    start: "22:30",
    end: "07:00",
  },
  ai: {
    baseUrl: "",
    model: "",
  },
};

export function createEmptyStore() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    setup: {
      completedAt: null,
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    planMirror: null,
    inbox: [],
    reminders: [],
    pushSubscriptions: [],
    deliveryLog: [],
  };
}

export async function readStore(file = DEFAULT_DATA_FILE) {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return createEmptyStore();
  }
}

export async function writeStore(store, file = DEFAULT_DATA_FILE) {
  const next = normalizeStore(store);
  next.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(next, null, 2));
  await fs.rename(tempFile, file);
  return next;
}

export function normalizeStore(store) {
  const base = createEmptyStore();
  const settings = normalizeSettings(store?.settings || {});
  return {
    ...base,
    ...store,
    setup: {
      completedAt: store?.setup?.completedAt || null,
    },
    settings,
    reminders: Array.isArray(store?.reminders) ? store.reminders.map(normalizeReminder).filter(Boolean) : [],
    pushSubscriptions: Array.isArray(store?.pushSubscriptions) ? store.pushSubscriptions.filter(Boolean) : [],
    inbox: Array.isArray(store?.inbox) ? store.inbox.slice(-80) : [],
    deliveryLog: Array.isArray(store?.deliveryLog) ? store.deliveryLog.slice(-160) : [],
  };
}

export function normalizeSettings(settings) {
  const merged = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...settings,
    channels: { ...DEFAULT_SETTINGS.channels, ...settings.channels },
    bark: { ...DEFAULT_SETTINGS.bark, ...settings.bark },
    webPush: { ...DEFAULT_SETTINGS.webPush, ...settings.webPush },
    quietHours: { ...DEFAULT_SETTINGS.quietHours, ...settings.quietHours },
    ai: { ...DEFAULT_SETTINGS.ai, ...settings.ai },
  };
  merged.reminderLeadMinutes = Array.from(
    new Set(
      (Array.isArray(settings.reminderLeadMinutes)
        ? settings.reminderLeadMinutes
        : DEFAULT_SETTINGS.reminderLeadMinutes
      )
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 180),
    ),
  ).sort((a, b) => b - a);
  if (merged.reminderLeadMinutes.length === 0) merged.reminderLeadMinutes = [10, 0];
  if (!merged.bark.server) merged.bark.server = DEFAULT_SETTINGS.bark.server;
  if (!["active", "timeSensitive", "passive"].includes(merged.bark.level)) {
    merged.bark.level = DEFAULT_SETTINGS.bark.level;
  }
  merged.bark.sound = String(merged.bark.sound || "")
    .trim()
    .slice(0, 40);
  merged.bark.archive = merged.bark.archive !== false;
  ensureVapidKeys(merged);
  return merged;
}

export function publicSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    ...normalized,
    bark: {
      server: normalized.bark.server,
      configured: Boolean(normalized.bark.key),
      level: normalized.bark.level,
      sound: normalized.bark.sound,
      archive: normalized.bark.archive,
    },
    webPush: {
      publicKey: normalized.webPush.publicKey,
      enabled: Boolean(normalized.webPush.publicKey && normalized.webPush.privateKey),
    },
    ai: {
      baseUrl: normalized.ai.baseUrl,
      model: normalized.ai.model,
      configured: Boolean(process.env.AI_API_KEY),
    },
  };
}

export async function loadLocalEnv(file = DEFAULT_ENV_FILE) {
  const env = await readEnvFile(file);
  for (const [key, value] of Object.entries(env)) {
    if (value && process.env[key] == null) process.env[key] = value;
  }
  return env;
}

export async function readEnvFile(file = DEFAULT_ENV_FILE) {
  try {
    return parseEnv(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

export async function writeEnvFile(values, file = DEFAULT_ENV_FILE) {
  await fs.writeFile(file, formatEnv(values));
}

export function applyEnvToSettings(settings) {
  const next = normalizeSettings(settings);
  if (process.env.BARK_KEY && !next.bark.key) {
    next.bark.key = process.env.BARK_KEY;
    next.channels.bark = true;
  }
  if (process.env.BARK_SERVER) next.bark.server = process.env.BARK_SERVER;
  if (process.env.AI_BASE_URL) next.ai.baseUrl = process.env.AI_BASE_URL;
  if (process.env.AI_MODEL) next.ai.model = process.env.AI_MODEL;
  return normalizeSettings(next);
}

export async function getSetupStatus(store, envFile = DEFAULT_ENV_FILE) {
  const env = await readEnvFile(envFile);
  const settings = publicSettings(store.settings);
  return {
    completed: Boolean(store.setup?.completedAt),
    needsSetup: !store.setup?.completedAt,
    envFile,
    hasAiKey: Boolean(process.env.AI_API_KEY || env.AI_API_KEY),
    hasBarkKey: Boolean(store.settings?.bark?.key || env.BARK_KEY),
    settings,
  };
}

export async function saveSetupConfig(store, input = {}, envFile = DEFAULT_ENV_FILE) {
  const currentEnv = await readEnvFile(envFile);
  const aiApiKey = cleanInput(input.aiApiKey) || currentEnv.AI_API_KEY || process.env.AI_API_KEY || "";
  const aiBaseUrl =
    cleanInput(input.aiBaseUrl) ||
    currentEnv.AI_BASE_URL ||
    process.env.AI_BASE_URL ||
    "https://api.openai.com/v1";
  const aiModel = cleanInput(input.aiModel) || currentEnv.AI_MODEL || process.env.AI_MODEL || "gpt-4o-mini";
  const barkKey = cleanInput(input.barkKey) || currentEnv.BARK_KEY || store.settings?.bark?.key || "";
  const barkServer =
    cleanInput(input.barkServer) ||
    currentEnv.BARK_SERVER ||
    store.settings?.bark?.server ||
    DEFAULT_SETTINGS.bark.server;

  const nextEnv = {
    ...currentEnv,
    AI_API_KEY: aiApiKey,
    AI_BASE_URL: aiBaseUrl,
    AI_MODEL: aiModel,
    BARK_KEY: barkKey,
    BARK_SERVER: barkServer,
  };
  await writeEnvFile(nextEnv, envFile);

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value) process.env[key] = value;
  }

  const channels = {
    ...store.settings.channels,
    ...(input.channels || {}),
    bark: Boolean((input.channels?.bark ?? store.settings.channels?.bark) && barkKey),
  };
  const barkPatch = {
    ...store.settings.bark,
    key: barkKey,
    server: barkServer,
  };
  if (input.barkLevel) barkPatch.level = cleanInput(input.barkLevel);
  if (input.barkSound != null) barkPatch.sound = cleanInput(input.barkSound);
  if (input.barkArchive != null) barkPatch.archive = Boolean(input.barkArchive);

  store.settings = normalizeSettings({
    ...store.settings,
    channels,
    bark: barkPatch,
    ai: { ...store.settings.ai, baseUrl: aiBaseUrl, model: aiModel },
    reminderLeadMinutes: input.reminderLeadMinutes || store.settings.reminderLeadMinutes,
    quietHours: { ...store.settings.quietHours, ...(input.quietHours || {}) },
  });
  store.setup = { completedAt: new Date().toISOString() };
  return store;
}

export function ensureVapidKeys(settings) {
  if (settings.webPush?.publicKey && settings.webPush?.privateKey) return settings;
  const keys = webpush.generateVAPIDKeys();
  settings.webPush = {
    ...settings.webPush,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
  return settings;
}

export function sanitizePlanDraft(input, selectedDate = isoDate()) {
  const fallback = fallbackParse(input?.sourceText || input?.text || "", selectedDate);
  const draft = input && typeof input === "object" ? input : {};
  const blocks = Array.isArray(draft.blocks)
    ? draft.blocks.map((block, index) => normalizeDraftBlock(block, index)).filter(Boolean)
    : fallback.blocks;
  const reviewQuestions = Array.isArray(draft.reviewQuestions)
    ? draft.reviewQuestions
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 5)
    : fallback.reviewQuestions;
  return {
    id: draft.id || `draft-${crypto.randomUUID()}`,
    goal: String(draft.goal || fallback.goal)
      .trim()
      .slice(0, 240),
    selectedDate,
    blocks: blocks.slice(0, 12),
    reminders: Array.isArray(draft.reminders) ? draft.reminders.slice(0, 24) : [],
    reviewQuestions,
    carryOver: Array.isArray(draft.carryOver) ? draft.carryOver.map(String).slice(0, 8) : fallback.carryOver,
    source: draft.source || "fallback",
    createdAt: draft.createdAt || new Date().toISOString(),
  };
}

export function fallbackParse(text, selectedDate = isoDate()) {
  const lines = String(text || "")
    .split(/\n|；|;|。/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(Boolean);
  const candidates = lines.length ? lines : ["整理输入", "推进最重要的一件事", "复盘下一步"];
  const goal = candidates[0]?.slice(0, 80) || "守住今天最重要的 3 件事";
  const startMinutes = 9 * 60;
  const blocks = candidates.slice(0, 6).map((line, index) => {
    const start = startMinutes + index * 75;
    return {
      id: `draft-block-${index + 1}`,
      title: line.slice(0, 80),
      note: index === 0 ? "由 AI 收件箱草稿生成，可确认后写入规划。" : "",
      start: minutesToTime(start),
      end: minutesToTime(start + (index === 0 ? 60 : 45)),
      type: index % 3 === 0 ? "deep" : index % 3 === 1 ? "ship" : "review",
      priority: index + 1,
      tags: [],
      selectedDate,
    };
  });
  return {
    id: `draft-${crypto.randomUUID()}`,
    goal,
    selectedDate,
    blocks,
    reminders: [],
    reviewQuestions: ["今天最值得保住的结果是什么？", "哪个时间块最容易被打断？", "今晚要把什么带到明天？"],
    carryOver: [],
    source: "fallback",
    createdAt: new Date().toISOString(),
  };
}

function normalizeDraftBlock(block, index) {
  if (!block || typeof block !== "object") return null;
  const title = String(block.title || block.name || "").trim();
  if (!title) return null;
  const start = isClockTime(block.start) ? block.start : minutesToTime(9 * 60 + index * 75);
  const end = isClockTime(block.end) ? block.end : minutesToTime(timeToMinutes(start) + 45);
  return {
    id: String(block.id || `draft-block-${index + 1}`),
    title: title.slice(0, 120),
    note: String(block.note || block.description || "")
      .trim()
      .slice(0, 240),
    start,
    end: timeToMinutes(end) > timeToMinutes(start) ? end : minutesToTime(timeToMinutes(start) + 45),
    type: ["deep", "ship", "admin", "review"].includes(block.type) ? block.type : "deep",
    priority: Number.isFinite(Number(block.priority)) ? Number(block.priority) : index + 1,
    tags: Array.isArray(block.tags) ? block.tags.map(String).slice(0, 5) : [],
  };
}

export async function parseWithAI({ text, selectedDate, settings }) {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL || settings?.ai?.baseUrl || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || settings?.ai?.model || "gpt-4o-mini";
  if (!apiKey)
    return { draft: fallbackParse(text, selectedDate), source: "fallback", warning: "AI_API_KEY 未配置" };

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是 Time Goalie 的规划解析器。只返回 JSON：goal, blocks, reminders, reviewQuestions, carryOver。blocks 字段必须包含 title,note,start,end,type,priority,tags。type 只能是 deep,ship,admin,review。时间用 HH:mm。",
          },
          {
            role: "user",
            content: `日期：${selectedDate}\n输入：\n${text}`,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return { draft: sanitizePlanDraft({ ...parsed, source: "ai" }, selectedDate), source: "ai" };
  } catch (error) {
    return {
      draft: fallbackParse(text, selectedDate),
      source: "fallback",
      warning: `AI 解析失败，已使用本地规则：${error.message}`,
    };
  }
}

export function scheduleFromPlan(plan, settings = DEFAULT_SETTINGS, date = plan?.selectedDate || isoDate()) {
  const day = plan?.days?.[date] || { blocks: [], goal: "" };
  const channels = enabledChannels(settings);
  const reminders = [];
  const blocks = Array.isArray(day.blocks) ? day.blocks : [];
  for (const block of blocks) {
    if (!block?.id || !isClockTime(block.start) || !isClockTime(block.end)) continue;
    for (const channel of channels) {
      for (const leadMinutes of settings.reminderLeadMinutes || [10, 0]) {
        reminders.push(
          buildReminder({
            planDate: date,
            block,
            fireAt: dateTimeISO(date, block.start, -leadMinutes),
            kind: leadMinutes > 0 ? "lead" : "start",
            channel,
            leadMinutes,
          }),
        );
      }
      reminders.push(
        buildReminder({
          planDate: date,
          block,
          fireAt: dateTimeISO(date, block.end, 10),
          kind: "overdue",
          channel,
          leadMinutes: -10,
        }),
      );
    }
  }
  for (const channel of channels) {
    reminders.push(systemReminder(date, "morning-brief", "08:00", channel, day.goal || "今日防线"));
    reminders.push(systemReminder(date, "evening-review", "21:30", channel, "晚间复盘"));
    reminders.push(systemReminder(date, "carry-over", "22:00", channel, "整理未完成任务到明天"));
  }
  return reminders.filter((reminder) => !isInQuietHours(reminder.fireAt, settings.quietHours));
}

function enabledChannels(settings) {
  const channels = [];
  if (settings.channels?.bark && settings.bark?.key) channels.push("bark");
  if (settings.channels?.webPush) channels.push("webPush");
  if (settings.channels?.inApp !== false) channels.push("inApp");
  return channels.length ? channels : ["inApp"];
}

function buildReminder({ planDate, block, fireAt, kind, channel, leadMinutes }) {
  const id = stableId(`${planDate}:${block.id}:${kind}:${channel}:${fireAt}`);
  const title =
    kind === "lead"
      ? `即将开始：${block.title}`
      : kind === "overdue"
        ? `检查进度：${block.title}`
        : `开始守门：${block.title}`;
  const body =
    kind === "lead"
      ? `${leadMinutes} 分钟后开始，先把环境清出来。`
      : kind === "overdue"
        ? "这个时间块已经结束，记录完成或重排。"
        : block.note || "现在开始执行这个时间块。";
  return normalizeReminder({
    id,
    planDate,
    blockId: block.id,
    kind,
    channel,
    fireAt,
    title,
    body,
    status: "pending",
    retryCount: 0,
  });
}

function systemReminder(date, kind, time, channel, body) {
  return normalizeReminder({
    id: stableId(`${date}:system:${kind}:${channel}:${time}`),
    planDate: date,
    blockId: null,
    kind,
    channel,
    fireAt: dateTimeISO(date, time),
    title:
      kind === "morning-brief"
        ? "Time Goalie 早间 Brief"
        : kind === "evening-review"
          ? "Time Goalie 晚间 Review"
          : "Time Goalie Carry-over",
    body,
    status: "pending",
    retryCount: 0,
  });
}

export function mergeReminders(existing, incoming) {
  const map = new Map();
  for (const reminder of existing || []) {
    const normalized = normalizeReminder(reminder);
    if (normalized) map.set(normalized.id, normalized);
  }
  for (const reminder of incoming || []) {
    const normalized = normalizeReminder(reminder);
    if (!normalized) continue;
    const current = map.get(normalized.id);
    map.set(normalized.id, current && current.status !== "pending" ? current : { ...current, ...normalized });
  }
  return [...map.values()].sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt));
}

export function normalizeReminder(reminder) {
  if (!reminder || typeof reminder !== "object") return null;
  const fireAt = new Date(reminder.fireAt);
  if (Number.isNaN(fireAt.getTime())) return null;
  return {
    id: String(
      reminder.id || stableId(`${reminder.blockId}:${reminder.kind}:${reminder.channel}:${reminder.fireAt}`),
    ),
    planDate: String(reminder.planDate || isoDate(fireAt)),
    blockId: reminder.blockId == null ? null : String(reminder.blockId),
    kind: String(reminder.kind || "start"),
    channel: ["bark", "webPush", "inApp"].includes(reminder.channel) ? reminder.channel : "inApp",
    fireAt: fireAt.toISOString(),
    title: String(reminder.title || "Time Goalie").slice(0, 120),
    body: String(reminder.body || "").slice(0, 500),
    status: ["pending", "delivered", "failed", "skipped"].includes(reminder.status)
      ? reminder.status
      : "pending",
    retryCount: Number(reminder.retryCount || 0),
    lastError: reminder.lastError ? String(reminder.lastError).slice(0, 240) : "",
    deliveredAt: reminder.deliveredAt || null,
  };
}

export async function deliverDueReminders(store, now = new Date()) {
  const settings = normalizeSettings(store.settings);
  configureWebPush(settings);
  const due = store.reminders.filter(
    (reminder) =>
      reminder.status === "pending" &&
      new Date(reminder.fireAt) <= now &&
      new Date(reminder.fireAt) > new Date(now.getTime() - 24 * 60 * 60 * 1000),
  );
  const deliveryLog = [...(store.deliveryLog || [])];
  for (const reminder of due) {
    try {
      await deliverReminder(reminder, settings, store.pushSubscriptions);
      reminder.status = "delivered";
      reminder.deliveredAt = new Date().toISOString();
      reminder.lastError = "";
    } catch (error) {
      reminder.retryCount += 1;
      reminder.status = reminder.retryCount >= 3 ? "failed" : "pending";
      reminder.lastError = error.message;
    }
    deliveryLog.push({
      id: `${reminder.id}:${Date.now()}`,
      reminderId: reminder.id,
      channel: reminder.channel,
      status: reminder.status,
      message: reminder.lastError || "delivered",
      at: new Date().toISOString(),
    });
  }
  store.deliveryLog = deliveryLog.slice(-160);
  return { due: due.length, delivered: due.filter((item) => item.status === "delivered").length };
}

export async function deliverReminder(reminder, settings, pushSubscriptions = []) {
  if (reminder.channel === "bark") return sendBark(settings.bark, reminder.title, reminder.body);
  if (reminder.channel === "webPush") return sendWebPush(settings, pushSubscriptions, reminder);
  return { ok: true, channel: "inApp" };
}

export async function sendBark(bark, title, body) {
  if (!bark?.key) throw new Error("Bark key 未配置");
  const server = (bark.server || DEFAULT_SETTINGS.bark.server).replace(/\/$/, "");
  const base = bark.key.startsWith("http")
    ? bark.key.replace(/\/$/, "")
    : `${server}/${encodeURIComponent(bark.key)}`;
  const params = new URLSearchParams({
    group: "Time Goalie",
    isArchive: bark.archive === false ? "0" : "1",
  });
  if (["active", "timeSensitive", "passive"].includes(bark.level)) params.set("level", bark.level);
  if (bark.sound) params.set("sound", bark.sound);
  const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(body || "Time Goalie")}?${params}`;
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Bark HTTP ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`);
  }
  return { ok: true, channel: "bark" };
}

export function configureWebPush(settings) {
  ensureVapidKeys(settings);
  webpush.setVapidDetails(
    "mailto:time-goalie@local",
    settings.webPush.publicKey,
    settings.webPush.privateKey,
  );
}

export async function sendWebPush(settings, subscriptions, reminder) {
  if (!subscriptions?.length) throw new Error("没有 Web Push 订阅");
  configureWebPush(settings);
  const payload = JSON.stringify({ title: reminder.title, body: reminder.body, tag: reminder.id });
  const results = await Promise.allSettled(
    subscriptions.map((subscription) => webpush.sendNotification(subscription, payload)),
  );
  if (results.every((result) => result.status === "rejected")) {
    throw new Error(results[0].reason?.message || "Web Push 发送失败");
  }
  return { ok: true, channel: "webPush" };
}

export function createIcs(plan, date = plan?.selectedDate || isoDate()) {
  const day = plan?.days?.[date] || { blocks: [], goal: "" };
  const events = (day.blocks || [])
    .filter((block) => isClockTime(block.start) && isClockTime(block.end))
    .map((block) => [
      "BEGIN:VEVENT",
      `UID:${stableId(`${date}:${block.id}`)}@time-goalie.local`,
      `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART:${icsStamp(new Date(`${date}T${block.start}:00`))}`,
      `DTEND:${icsStamp(new Date(`${date}T${block.end}:00`))}`,
      `SUMMARY:${escapeIcs(block.title)}`,
      `DESCRIPTION:${escapeIcs(block.note || day.goal || "Time Goalie")}`,
      "END:VEVENT",
    ]);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Time Goalie//Local//ZH",
    ...events.flat(),
    "END:VCALENDAR",
  ].join("\r\n");
}

function icsStamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function cleanInput(value) {
  return String(value || "").trim();
}

function parseEnv(raw) {
  const result = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value.replace(/\\n/g, "\n");
  }
  return result;
}

function formatEnv(values) {
  const order = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "BARK_KEY", "BARK_SERVER"];
  const keys = [
    ...order,
    ...Object.keys(values)
      .filter((key) => !order.includes(key))
      .sort(),
  ];
  const lines = [
    "# Time Goalie local runtime configuration",
    "# Generated by the first-run setup dialog. Do not commit this file.",
  ];
  for (const key of keys) {
    if (values[key] == null) continue;
    lines.push(`${key}=${quoteEnvValue(values[key])}`);
  }
  return `${lines.join("\n")}\n`;
}

function quoteEnvValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function stableId(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

function dateTimeISO(date, time, offsetMinutes = 0) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes - offsetMinutes).toISOString();
}

function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isClockTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return false;
  const [hours, minutes] = time.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function isInQuietHours(fireAt, quietHours) {
  if (!quietHours?.enabled || !isClockTime(quietHours.start) || !isClockTime(quietHours.end)) return false;
  const date = new Date(fireAt);
  const current = date.getHours() * 60 + date.getMinutes();
  const start = timeToMinutes(quietHours.start);
  const end = timeToMinutes(quietHours.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}
