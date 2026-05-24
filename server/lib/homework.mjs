import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_STATE = {
  updatedAt: null,
  lastScanAt: null,
  lastDeliveryAt: null,
  snapshot: null,
  events: [],
  deliveryLog: [],
  acknowledgements: [],
};

export const DEFAULT_CONFIG = {
  port: 4588,
  host: "127.0.0.1",
  dataFile: "/var/lib/homework-goalie/state.json",
  syncToken: "",
  bark: {
    key: "",
    server: "https://api.day.app",
    level: "timeSensitive",
    sound: "",
    archive: true,
  },
  reminderTimes: {
    morning: "06:45",
    afterSchool: "16:40",
    evening: "21:15",
  },
  quietHours: {
    start: "23:30",
    end: "06:30",
  },
};

const BIG_WORK_RE =
  /summative|project|essay|presentation|process journal|criterion|criteria|research|report|review|robotics|portfolio|draft|reflection|演讲|作文|总结|项目|研究|读书笔记|跨学科/i;
const ADMIN_RE = /survey|form|feedback form|确认|家长|permission|问卷|调查|收集/i;

export function configFromEnv(env = process.env) {
  return {
    ...DEFAULT_CONFIG,
    port: Number(env.HOMEWORK_GOALIE_PORT || env.PORT || DEFAULT_CONFIG.port),
    host: env.HOMEWORK_GOALIE_HOST || DEFAULT_CONFIG.host,
    dataFile: env.HOMEWORK_GOALIE_DATA_FILE || DEFAULT_CONFIG.dataFile,
    syncToken: env.HOMEWORK_GOALIE_SYNC_TOKEN || "",
    bark: {
      key: env.BARK_KEY || "",
      server: env.BARK_SERVER || DEFAULT_CONFIG.bark.server,
      level: env.BARK_LEVEL || DEFAULT_CONFIG.bark.level,
      sound: env.BARK_SOUND || "",
      archive: env.BARK_ARCHIVE !== "0",
    },
    reminderTimes: {
      morning: env.MORNING_BRIEF_TIME || DEFAULT_CONFIG.reminderTimes.morning,
      afterSchool: env.AFTER_SCHOOL_BRIEF_TIME || DEFAULT_CONFIG.reminderTimes.afterSchool,
      evening: env.EVENING_BRIEF_TIME || DEFAULT_CONFIG.reminderTimes.evening,
    },
    quietHours: {
      start: env.QUIET_START || DEFAULT_CONFIG.quietHours.start,
      end: env.QUIET_END || DEFAULT_CONFIG.quietHours.end,
    },
  };
}

export async function readJson(file, fallback = DEFAULT_STATE) {
  try {
    return { ...fallback, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    return structuredClone(fallback);
  }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
  return value;
}

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const data = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    data[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return data;
}

export function extractSection(text, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im");
  const match = text.match(pattern);
  if (!match || match.index == null) return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

export async function buildSnapshot({ vaultPath, now = new Date() }) {
  const assignmentsDir = path.join(vaultPath, "Assignments");
  const files = await readdir(assignmentsDir);
  const assignments = [];
  for (const file of files.filter((item) => item.endsWith(".md") && item !== ".keep")) {
    const absolutePath = path.join(assignmentsDir, file);
    const text = await readFile(absolutePath, "utf8");
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter.title || !frontmatter.due) continue;
    const item = normalizeAssignment({ frontmatter, text, absolutePath, vaultPath, now });
    if (isWithinActiveWindow(item, now)) assignments.push(item);
  }
  assignments.sort((a, b) => a.due.localeCompare(b.due) || a.subject.localeCompare(b.subject));
  const openAssignments = assignments.filter((item) => item.status !== "done");
  return {
    generatedAt: now.toISOString(),
    source: "homework-vault",
    vaultPath,
    assignments,
    summary: summarizeAssignments(assignments, now),
    scanErrors: [],
    nextActions: openAssignments.filter((item) => item.riskLevel !== "clear").slice(0, 10),
  };
}

export function normalizeAssignment({ frontmatter, text, absolutePath, vaultPath, now = new Date() }) {
  const requirements = extractSection(text, "Requirements");
  const progress = extractSection(text, "Progress");
  const submission = extractSection(text, "Submission");
  const details = extractSection(text, "ManageBac Details");
  const managebacSync = extractSection(text, "ManageBac Sync");
  const submissionUrl = findSubmissionUrl(submission || text);
  const relativePath = path.relative(vaultPath, absolutePath).split(path.sep).join("/");
  const base = {
    id: frontmatter.managebac_id || stableId(relativePath),
    title: frontmatter.title,
    subject: frontmatter.subject || frontmatter.managebac_class || "Unknown",
    due: frontmatter.due,
    status: frontmatter.status || "not-started",
    priority: frontmatter.priority || "medium",
    source: frontmatter.source || "managebac",
    managebacState: frontmatter.managebac_state || "unknown",
    managebacClass: frontmatter.managebac_class || "",
    managebacUrl: frontmatter.managebac_url || "",
    submissionUrl,
    notePath: absolutePath,
    relativePath,
    requirementsSummary: summarizeText(requirements || details || managebacSync, 700),
    localProgressSignals: localProgressSignals(progress, submission),
  };
  return {
    ...base,
    ...classifyRisk(base, now),
  };
}

export function classifyRisk(assignment, now = new Date()) {
  const dueAt = dueEndOfDay(assignment.due);
  const hoursLeft = (dueAt.getTime() - now.getTime()) / 3_600_000;
  const submitted =
    assignment.status === "done" ||
    assignment.managebacState === "submitted" ||
    /submitted/i.test(assignment.managebacState || "");
  const bigWork = isBigWork(assignment);
  const canAutoAdmin = isAdministrative(assignment);
  const hasDraft = Boolean(assignment.localProgressSignals?.hasSubstantialDraft);

  if (submitted) {
    return {
      riskLevel: "clear",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: false,
      recommendedNextAction: "已提交/已完成",
    };
  }
  if (hoursLeft < 0) {
    return {
      riskLevel: "critical",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: bigWork && !hasDraft,
      recommendedNextAction: "已经过期：立刻检查 ManageBac 状态和可补交入口",
    };
  }
  if (hoursLeft <= 6 && bigWork && !hasDraft) {
    return {
      riskLevel: "rescue",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: true,
      recommendedNextAction: "进入救援：整理要求、生成最小可交付草稿，并等待 Felix 确认提交",
    };
  }
  if (hoursLeft <= 6) {
    return {
      riskLevel: "critical",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: false,
      recommendedNextAction: "6 小时内截止：确认已有稿件并提交",
    };
  }
  if (hoursLeft <= 24) {
    return {
      riskLevel: "urgent",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: false,
      recommendedNextAction: "24 小时内截止：今天完成或上传",
    };
  }
  if (hoursLeft <= 72) {
    return {
      riskLevel: "watch",
      hoursLeft,
      bigWork,
      canAutoAdmin,
      rescueEligible: false,
      recommendedNextAction: "未来 3 天截止：安排一段作业时间",
    };
  }
  return {
    riskLevel: "clear",
    hoursLeft,
    bigWork,
    canAutoAdmin,
    rescueEligible: false,
    recommendedNextAction: "暂无紧急动作",
  };
}

export function buildRescuePacket(assignment) {
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    subject: assignment.subject,
    due: assignment.due,
    riskLevel: assignment.riskLevel,
    requirementsSummary:
      assignment.requirementsSummary || "没有抓到明确要求，需要打开 ManageBac 详情页复核。",
    localEvidence: assignment.localProgressSignals,
    minimumDeliverable: minimumDeliverableFor(assignment),
    submissionUrl: assignment.submissionUrl,
    managebacUrl: assignment.managebacUrl,
    allowedActions: assignment.canAutoAdmin
      ? ["draft", "notify", "prepare-upload", "submit-only-if-preauthorized-admin-form"]
      : ["draft", "notify", "prepare-upload", "submit-after-felix-confirmation"],
    blockedActions: ["unconfirmed-graded-submission", "cookie-export-to-pi"],
  };
}

export function createEventsFromSnapshot(snapshot, config = DEFAULT_CONFIG, now = new Date()) {
  const events = [];
  const open = (snapshot.assignments || []).filter((item) => item.status !== "done");
  const risky = open.filter((item) => ["watch", "urgent", "critical", "rescue"].includes(item.riskLevel));
  if (risky.length) {
    events.push(
      systemEvent(
        "morning-brief",
        snapshot.generatedAt,
        nextTime(config.reminderTimes.morning, now),
        briefTitle(risky),
        briefBody(risky),
      ),
    );
    events.push(
      systemEvent(
        "after-school",
        snapshot.generatedAt,
        nextTime(config.reminderTimes.afterSchool, now),
        "Homework Goalie 放学检查",
        briefBody(risky.slice(0, 6)),
      ),
    );
    events.push(
      systemEvent(
        "evening-brief",
        snapshot.generatedAt,
        nextTime(config.reminderTimes.evening, now),
        "Homework Goalie 晚间收口",
        briefBody(risky.slice(0, 6)),
      ),
    );
  }
  for (const item of risky) {
    const dueAt = dueEndOfDay(item.due);
    const title = `${riskLabel(item.riskLevel)} ${item.subject}: ${item.title}`.slice(0, 120);
    const body =
      `${item.due} 截止 · ${item.recommendedNextAction}${item.submissionUrl ? ` · ${item.submissionUrl}` : ""}`.slice(
        0,
        500,
      );
    if (["urgent", "critical", "rescue"].includes(item.riskLevel)) {
      events.push(assignmentEvent(item, "risk-now", now, title, body));
    }
    for (const [kind, hours] of [
      ["due-24h", 24],
      ["due-12h", 12],
      ["due-6h", 6],
      ["due-2h", 2],
      ["due-45m", 0.75],
    ]) {
      const fireAt = new Date(dueAt.getTime() - hours * 3_600_000);
      if (fireAt >= now) events.push(assignmentEvent(item, kind, fireAt, title, body));
    }
  }
  return events.filter((event) => !isInQuietHours(event.fireAt, config.quietHours));
}

export function mergeEvents(existing = [], incoming = []) {
  const map = new Map();
  for (const event of existing) map.set(event.id, event);
  for (const event of incoming) {
    const old = map.get(event.id);
    if (old && ["delivered", "acknowledged"].includes(old.status)) continue;
    map.set(event.id, { ...old, ...event, status: old?.status === "failed" ? "pending" : event.status });
  }
  return [...map.values()].sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt));
}

export async function deliverDueEvents(state, config = DEFAULT_CONFIG, now = new Date()) {
  const due = state.events.filter((event) => event.status === "pending" && new Date(event.fireAt) <= now);
  for (const event of due) {
    try {
      await sendBark(config.bark, event.title, event.body);
      event.status = "delivered";
      event.deliveredAt = now.toISOString();
      event.lastError = "";
      state.lastDeliveryAt = now.toISOString();
      state.deliveryLog.push({
        id: event.id,
        at: now.toISOString(),
        status: "delivered",
        title: event.title,
      });
    } catch (error) {
      event.retryCount = (event.retryCount || 0) + 1;
      event.lastError = error.message || String(error);
      event.status = event.retryCount >= 3 ? "failed" : "pending";
      state.deliveryLog.push({
        id: event.id,
        at: now.toISOString(),
        status: "failed",
        title: event.title,
        error: event.lastError,
      });
    }
  }
  state.deliveryLog = state.deliveryLog.slice(-80);
  return due.length;
}

export async function sendBark(bark, title, body) {
  if (!bark?.key) throw new Error("BARK_KEY missing");
  const server = (bark.server || DEFAULT_CONFIG.bark.server).replace(/\/$/, "");
  const base = bark.key.startsWith("http")
    ? bark.key.replace(/\/$/, "")
    : `${server}/${encodeURIComponent(bark.key)}`;
  const params = new URLSearchParams({
    group: "Homework Goalie",
    isArchive: bark.archive === false ? "0" : "1",
  });
  if (["active", "timeSensitive", "passive"].includes(bark.level)) params.set("level", bark.level);
  if (bark.sound) params.set("sound", bark.sound);
  const url = `${base}/${encodeURIComponent(title)}/${encodeURIComponent(body || "Homework Goalie")}?${params}`;
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Bark HTTP ${response.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
  }
  return { ok: true };
}

export function statusPayload(state, config = DEFAULT_CONFIG, now = new Date()) {
  const pending = state.events.filter((event) => event.status === "pending");
  const failed = state.events.filter((event) => event.status === "failed");
  const rescue = state.snapshot?.assignments?.filter((item) => item.riskLevel === "rescue") || [];
  return {
    ok: true,
    updatedAt: state.updatedAt,
    lastScanAt: state.lastScanAt,
    lastDeliveryAt: state.lastDeliveryAt,
    stale: isSnapshotStale(state, now),
    barkConfigured: Boolean(config.bark.key),
    pending: pending.length,
    failed: failed.length,
    rescue: rescue.length,
    nextEvent: pending.sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt))[0] || null,
    summary: state.snapshot?.summary || null,
  };
}

export function isSnapshotStale(state, now = new Date()) {
  if (!state.lastScanAt) return true;
  return now.getTime() - new Date(state.lastScanAt).getTime() > 26 * 3_600_000;
}

export function buildStaleSnapshotEvent(state, now = new Date()) {
  if (!isSnapshotStale(state, now)) return null;
  return {
    id: `system:stale-snapshot:${now.toISOString().slice(0, 10)}`,
    assignmentId: null,
    kind: "stale-snapshot",
    riskLevel: "critical",
    fireAt: now.toISOString(),
    title: "Homework Goalie 扫描过期",
    body: "超过 26 小时没有收到 Codex 作业扫描结果，请检查 ManageBac sync / Codex automation。",
    status: "pending",
    retryCount: 0,
    lastError: "",
  };
}

function summarizeAssignments(assignments, now) {
  const open = assignments.filter((item) => item.status !== "done");
  const dueToday = open.filter((item) => item.due === isoDate(now)).length;
  return {
    total: assignments.length,
    open: open.length,
    dueToday,
    watch: open.filter((item) => item.riskLevel === "watch").length,
    urgent: open.filter((item) => item.riskLevel === "urgent").length,
    critical: open.filter((item) => item.riskLevel === "critical").length,
    rescue: open.filter((item) => item.riskLevel === "rescue").length,
  };
}

function isWithinActiveWindow(assignment, now) {
  const dueAt = dueEndOfDay(assignment.due);
  const oldestActionable = new Date(now.getTime() - 3 * 24 * 3_600_000);
  if (dueAt >= oldestActionable) return true;
  return assignment.status === "in-progress" && dueAt >= new Date(now.getTime() - 30 * 24 * 3_600_000);
}

function localProgressSignals(progress, submission) {
  const progressText = stripBoilerplate(progress);
  const submissionText = stripBoilerplate(submission.replace(/Upload Submission:?\s*\S*/gi, ""));
  return {
    hasProgressNotes: progressText.length > 40,
    hasSubmissionDraft: submissionText.length > 80,
    hasSubstantialDraft: progressText.length + submissionText.length > 500,
    progressChars: progressText.length,
    submissionChars: submissionText.length,
  };
}

function minimumDeliverableFor(assignment) {
  if (/essay|作文|reflection|review|读书笔记/i.test(assignment.title))
    return "一份结构完整的文稿：题目/观点/证据/结论，优先满足 rubric。";
  if (/presentation|演讲/i.test(assignment.title))
    return "可上传的讲稿或 slides 大纲，包含开头、主体要点和结尾。";
  if (/robotics|design|project|portfolio/i.test(assignment.title))
    return "按 Criterion/strand 整理的过程文档和截图占位，保证可提交。";
  return "按 ManageBac 要求整理一份最小可交付稿件，先可提交，再优化。";
}

function findSubmissionUrl(text) {
  return text.match(/https:\/\/ibwya\.managebac\.cn\/\S*\/dropbox\b\S*/)?.[0] || "";
}

function isBigWork(assignment) {
  return (
    assignment.priority === "high" ||
    BIG_WORK_RE.test(`${assignment.title}\n${assignment.requirementsSummary || ""}`)
  );
}

function isAdministrative(assignment) {
  return (
    ADMIN_RE.test(`${assignment.title}\n${assignment.requirementsSummary || ""}`) && !isBigWork(assignment)
  );
}

function systemEvent(kind, scanId, fireAt, title, body) {
  return {
    id: `system:${kind}:${scanId.slice(0, 10)}`,
    assignmentId: null,
    kind,
    riskLevel: "watch",
    fireAt: fireAt.toISOString(),
    title,
    body,
    status: "pending",
    retryCount: 0,
    lastError: "",
  };
}

function assignmentEvent(item, kind, fireAt, title, body) {
  return {
    id: `${item.id}:${kind}:${item.due}`,
    assignmentId: item.id,
    kind,
    riskLevel: item.riskLevel,
    fireAt: fireAt.toISOString(),
    title,
    body,
    status: "pending",
    retryCount: 0,
    lastError: "",
    rescuePacket: item.rescueEligible ? buildRescuePacket(item) : null,
  };
}

function nextTime(value, now) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  if (date < now) date.setDate(date.getDate() + 1);
  return date;
}

function dueEndOfDay(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 0, 0);
}

function isInQuietHours(iso, quietHours = DEFAULT_CONFIG.quietHours) {
  const date = new Date(iso);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = timeToMinutes(quietHours.start);
  const end = timeToMinutes(quietHours.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function briefTitle(items) {
  const rescue = items.filter((item) => item.riskLevel === "rescue").length;
  const critical = items.filter((item) => item.riskLevel === "critical").length;
  if (rescue) return `Homework Goalie 救援 ${rescue}`;
  if (critical) return `Homework Goalie 高危 ${critical}`;
  return `Homework Goalie 今日作业 ${items.length}`;
}

function briefBody(items) {
  return items
    .slice(0, 6)
    .map((item) => `${item.due} ${item.subject}: ${item.title}`)
    .join(" | ")
    .slice(0, 500);
}

function riskLabel(level) {
  if (level === "rescue") return "救援";
  if (level === "critical") return "高危";
  if (level === "urgent") return "紧急";
  return "提醒";
}

function summarizeText(text, maxLength) {
  return stripBoilerplate(text).replace(/\s+/g, " ").slice(0, maxLength);
}

function stripBoilerplate(text) {
  return String(text || "")
    .replace(/^-?\s*(No progress yet|No submission notes yet|Upload Submission)\.?$/gim, "")
    .trim();
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function stableId(input) {
  let hash = 0;
  for (const char of input) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `local-${hash.toString(16)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function moduleDir(importMetaUrl = import.meta.url) {
  return path.dirname(fileURLToPath(importMetaUrl));
}
