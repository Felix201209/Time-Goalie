export const DAY_START_MINUTES = 6 * 60;
export const DAY_END_MINUTES = 23 * 60;

export function isClockTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return false;
  const [hours, minutes] = time.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function toMinutes(time) {
  if (!isClockTime(time)) return 0;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toTime(minutes) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(bounded / 60);
  const mins = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function durationLabel(start, end) {
  return formatMinutes(Math.max(0, toMinutes(end) - toMinutes(start)));
}

export function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export function isValidTimeRange(start, end) {
  return isClockTime(start) && isClockTime(end) && toMinutes(end) > toMinutes(start);
}

export function clampTimelinePercent(time) {
  const minutes = toMinutes(time);
  const range = DAY_END_MINUTES - DAY_START_MINUTES;
  return Math.max(2, Math.min(96, ((minutes - DAY_START_MINUTES) / range) * 100));
}

export function normalizeBlocks(blocks) {
  return [...blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function findOverlaps(blocks) {
  const sorted = normalizeBlocks(blocks).filter((block) => isValidTimeRange(block.start, block.end));
  const ids = new Set();

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const currentEnd = toMinutes(current.end);
    for (let j = i + 1; j < sorted.length; j += 1) {
      const next = sorted[j];
      if (toMinutes(next.start) >= currentEnd) break;
      ids.add(current.id);
      ids.add(next.id);
    }
  }

  return ids;
}

export function getOverlapDetails(blocks) {
  const valid = normalizeBlocks(blocks).filter((block) => isValidTimeRange(block.start, block.end));
  const map = new Map();

  for (let i = 0; i < valid.length; i += 1) {
    const a = valid[i];
    const aStart = toMinutes(a.start);
    const aEnd = toMinutes(a.end);
    const conflicts = [];
    for (let j = 0; j < valid.length; j += 1) {
      if (i === j) continue;
      const b = valid[j];
      const bStart = toMinutes(b.start);
      const bEnd = toMinutes(b.end);
      if (bStart < aEnd && bEnd > aStart) {
        conflicts.push(b);
      }
    }
    if (conflicts.length) {
      map.set(a.id, conflicts);
    }
  }

  return map;
}

export function computeOverlapLayout(blocks) {
  const valid = normalizeBlocks(blocks).filter((block) => isValidTimeRange(block.start, block.end));
  const columns = [];
  const result = new Map();

  for (const block of valid) {
    const start = toMinutes(block.start);
    const end = toMinutes(block.end);
    let col = columns.findIndex((lastEnd) => lastEnd <= start);
    if (col === -1) col = columns.length;
    columns[col] = end;
    result.set(block.id, { column: col });
  }

  const totalColumns = columns.length || 1;
  for (const value of result.values()) {
    value.totalColumns = totalColumns;
  }
  return result;
}

export function blockTimelineStyle(start, end) {
  if (!isValidTimeRange(start, end)) {
    return {
      top: `${clampTimelinePercent(start)}%`,
      height: "3.5%",
    };
  }
  const range = DAY_END_MINUTES - DAY_START_MINUTES;
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  const rawTop = ((startMin - DAY_START_MINUTES) / range) * 100;
  const rawHeight = ((endMin - startMin) / range) * 100;
  const top = Math.max(2, Math.min(96, rawTop));
  const bottom = Math.max(2, Math.min(96, rawTop + rawHeight));
  return {
    top: `${top}%`,
    height: `${Math.max(bottom - top, 3.5)}%`,
  };
}

export function getActiveBlock(blocks, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return normalizeBlocks(blocks).find(
    (block) =>
      isActionableBlock(block) && toMinutes(block.start) <= minutes && minutes < toMinutes(block.end),
  );
}

export function getNextBlock(blocks, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return normalizeBlocks(blocks).find(
    (block) => isActionableBlock(block) && toMinutes(block.start) > minutes,
  );
}

function isActionableBlock(block) {
  return block.status !== "done" && block.status !== "skipped" && isValidTimeRange(block.start, block.end);
}

export function roundUpToStep(minutes, step = 15) {
  return Math.ceil(minutes / step) * step;
}

export function findOpenSlot(blocks, preferredStart = 9 * 60, duration = 60, options = {}) {
  const sorted = normalizeBlocks(blocks).filter((block) => isValidTimeRange(block.start, block.end));
  const windows = [];
  let cursor = DAY_START_MINUTES;

  for (const block of sorted) {
    const start = toMinutes(block.start);
    if (start > cursor) windows.push([cursor, start]);
    cursor = Math.max(cursor, toMinutes(block.end));
  }

  if (cursor < DAY_END_MINUTES) windows.push([cursor, DAY_END_MINUTES]);

  if (options.allowPastFallback === false && preferredStart > DAY_END_MINUTES - duration) return null;

  const preferred = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES - duration, preferredStart));
  const best = windows.find(([start, end]) => Math.max(start, preferred) + duration <= end);
  const fallback =
    options.allowPastFallback === false ? null : windows.find(([start, end]) => start + duration <= end);
  const slotStart = best ? Math.max(best[0], preferred) : fallback?.[0];

  if (slotStart == null) return null;

  return {
    start: toTime(slotStart),
    end: toTime(Math.min(DAY_END_MINUTES, slotStart + duration)),
  };
}

export function getPlanStats(blocks) {
  const validBlocks = blocks.filter((block) => isValidTimeRange(block.start, block.end));
  const plannedMinutes = validBlocks.reduce(
    (sum, block) => sum + Math.max(0, toMinutes(block.end) - toMinutes(block.start)),
    0,
  );
  const doneMinutes = validBlocks
    .filter((block) => block.status === "done")
    .reduce((sum, block) => sum + Math.max(0, toMinutes(block.end) - toMinutes(block.start)), 0);

  return {
    plannedMinutes,
    doneMinutes,
    totalBlocks: blocks.length,
    doneBlocks: validBlocks.filter((block) => block.status === "done").length,
  };
}

export function safeDomToken(value, fallback = "item") {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "-") || fallback;
}

let fallbackIdCounter = 0;

export function makeId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `block-${uuid}`;
  const bytes = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(bytes);
  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  const entropy = bytes[0] || Math.floor(Math.random() * 0xffffffff);
  return `block-${Date.now()}-${fallbackIdCounter.toString(36)}-${entropy.toString(36)}-${bytes[1].toString(36)}`;
}
