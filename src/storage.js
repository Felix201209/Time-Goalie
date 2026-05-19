import { isClockTime } from "./utils.js";

const STORAGE_KEY = "time-goalie.plan.v1";
const VALID_TYPES = new Set(["deep", "ship", "admin", "review"]);
const VALID_STATUSES = new Set(["planned", "done", "skipped"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ID_LENGTH = 96;
export const MAX_TITLE_LENGTH = 160;
export const MAX_NOTE_LENGTH = 500;
export const MAX_GOAL_LENGTH = 800;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlanCandidate(value) {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.blocks)) return true;
  return isRecord(value.days) && Object.keys(value.days).some((date) => isISODate(date));
}

export function isISODate(value) {
  if (!DATE_PATTERN.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysISO(value, offset) {
  if (!isISODate(value)) return todayISO();
  const [year, month, day] = value.split("-").map(Number);
  return todayISO(new Date(year, month - 1, day + offset));
}

export function createSeedDay() {
  return {
    goal: "守住今天最重要的 3 件事",
    blocks: [
      {
        id: "seed-1",
        title: "深度规划",
        note: "拆出今天真正要守住的目标",
        start: "09:00",
        end: "10:15",
        type: "deep",
        status: "planned",
      },
      {
        id: "seed-2",
        title: "执行冲刺",
        note: "只推进一个任务",
        start: "10:30",
        end: "12:00",
        type: "ship",
        status: "planned",
      },
      {
        id: "seed-3",
        title: "整理复盘",
        note: "清空尾巴，更新下一步",
        start: "16:30",
        end: "17:00",
        type: "review",
        status: "planned",
      },
    ],
  };
}

export function createEmptyDay() {
  return {
    goal: "守住这一天最重要的 3 件事",
    blocks: [],
  };
}

export function createSeedPlan() {
  const selectedDate = todayISO();
  return {
    focusMode: false,
    selectedDate,
    days: {
      [selectedDate]: createSeedDay(),
    },
  };
}

export function getDay(plan, date = plan.selectedDate) {
  return plan.days?.[date] || createEmptyDay();
}

function normalizeBlock(block, index = 0, seenIds = new Set()) {
  if (!block || typeof block !== "object") return null;
  const title = String(block.title || "")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const start = String(block.start || "");
  const end = String(block.end || "");
  if (!title || !isClockTime(start) || !isClockTime(end)) return null;
  const rawId = String(block.id || `imported-${Date.now()}-${index}`).slice(0, MAX_ID_LENGTH);
  let id = rawId;
  let suffix = index;
  while (seenIds.has(id)) {
    id = `${rawId}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(id);

  return {
    id,
    title,
    note: String(block.note || "")
      .trim()
      .slice(0, MAX_NOTE_LENGTH),
    start,
    end,
    type: VALID_TYPES.has(block.type) ? block.type : "deep",
    status: VALID_STATUSES.has(block.status) ? block.status : "planned",
  };
}

function normalizeDay(day) {
  const fallback = createEmptyDay();
  const seenIds = new Set();
  const blocks = Array.isArray(day?.blocks)
    ? day.blocks.map((block, index) => normalizeBlock(block, index, seenIds)).filter(Boolean)
    : [];
  return {
    goal:
      String(day?.goal || fallback.goal)
        .trim()
        .slice(0, MAX_GOAL_LENGTH) || fallback.goal,
    blocks,
  };
}

export function ensurePlanShape(plan) {
  const freshSeed = createSeedPlan();
  const legacyBlocks = Array.isArray(plan?.blocks) ? plan.blocks : null;
  const legacyDay = legacyBlocks ? { goal: plan.goal || createEmptyDay().goal, blocks: legacyBlocks } : null;
  const days = isRecord(plan?.days) ? plan.days : {};
  const normalizedDays = Object.fromEntries(
    Object.entries(days)
      .filter(([date]) => isISODate(date))
      .map(([date, day]) => [date, normalizeDay(day)]),
  );
  const normalizedLegacyDay = legacyDay ? normalizeDay(legacyDay) : null;
  const firstImportedDate = Object.keys(normalizedDays)[0];
  const selectedDate = isISODate(plan?.selectedDate || "")
    ? plan.selectedDate
    : firstImportedDate || freshSeed.selectedDate;

  return {
    focusMode: Boolean(plan?.focusMode),
    selectedDate,
    days: {
      ...normalizedDays,
      ...(normalizedLegacyDay ? { [selectedDate]: normalizedLegacyDay } : {}),
      [selectedDate]: normalizedDays[selectedDate] || normalizedLegacyDay || createEmptyDay(),
    },
  };
}

export function revivePlanForToday(plan, currentDate = todayISO()) {
  const shaped = ensurePlanShape(plan);
  if (!isISODate(currentDate) || shaped.selectedDate >= currentDate) return shaped;

  return {
    ...shaped,
    selectedDate: currentDate,
    days: {
      ...shaped.days,
      [currentDate]: shaped.days[currentDate] || createSeedDay(),
    },
  };
}

export function loadPlan() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return createSeedPlan();
    const parsed = JSON.parse(raw);
    if (!isPlanCandidate(parsed)) return createSeedPlan();
    return revivePlanForToday(parsed);
  } catch {
    return createSeedPlan();
  }
}

export function savePlan(plan) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function exportPlan(plan) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), plan }, null, 2);
}

export function exportFileName(plan, date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("-");
  return `time-goalie-${plan.selectedDate}_${stamp}_${time}.json`;
}

export function importPlan(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON 格式不正确，请检查导入内容");
  }
  const candidate = parsed.plan || parsed;
  if (!isPlanCandidate(candidate)) {
    throw new Error("导入文件不是 Time Goalie 规划数据");
  }
  return ensurePlanShape(candidate);
}
