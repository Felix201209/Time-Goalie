import { describe, expect, it, vi } from "vitest";
import {
  addDaysISO,
  createEmptyDay,
  createSeedDay,
  createSeedPlan,
  exportFileName,
  exportPlan,
  getDay,
  importPlan,
  isISODate,
  loadPlan,
  revivePlanForToday,
  savePlan,
  todayISO,
} from "./storage.js";
import { createDebouncedSaver } from "./persistence.js";
import { applyDateFromURL, getDateFromURL, syncDateToURL } from "./urlDate.js";
import {
  blockTimelineStyle,
  computeOverlapLayout,
  durationLabel,
  findOverlaps,
  formatMinutes,
  getActiveBlock,
  findOpenSlot,
  getNextBlock,
  getOverlapDetails,
  getPlanStats,
  isClockTime,
  isValidTimeRange,
  makeId,
  roundUpToStep,
  safeDomToken,
  toMinutes,
  toTime,
} from "./utils.js";

describe("time utilities", () => {
  it("formats local dates without UTC day drift", () => {
    expect(todayISO(new Date(2026, 4, 13, 0, 6))).toBe("2026-05-13");
  });

  it("validates real ISO calendar dates", () => {
    expect(isISODate("2026-05-13")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-99-99")).toBe(false);
  });

  it("moves ISO dates by local calendar days", () => {
    expect(addDaysISO("2026-05-13", 1)).toBe("2026-05-14");
    expect(addDaysISO("2026-06-01", -1)).toBe("2026-05-31");
    expect(isISODate(addDaysISO("bad-date", 1))).toBe(true);
  });

  it("converts time strings and minute values", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toTime(570)).toBe("09:30");
  });

  it("rejects impossible clock times", () => {
    expect(isClockTime("23:59")).toBe(true);
    expect(isClockTime("24:00")).toBe(false);
    expect(isClockTime("09:60")).toBe(false);
    expect(toMinutes("99:99")).toBe(0);
  });

  it("formats duration labels", () => {
    expect(durationLabel("09:00", "10:30")).toBe("1h 30m");
    expect(durationLabel("09:00", "09:25")).toBe("25m");
  });

  it("formats aggregate minute totals without rounding away detail", () => {
    expect(formatMinutes(225)).toBe("3h 45m");
    expect(formatMinutes(30)).toBe("30m");
  });

  it("validates time ranges", () => {
    expect(isValidTimeRange("09:00", "10:00")).toBe(true);
    expect(isValidTimeRange("10:00", "09:00")).toBe(false);
    expect(isValidTimeRange("10:00", "10:00")).toBe(false);
    expect(isValidTimeRange("", "10:00")).toBe(false);
    expect(isValidTimeRange("09:00", "bad")).toBe(false);
  });

  it("creates safe DOM tokens from imported ids", () => {
    expect(safeDomToken('weird id / <> " quote 中文 123', "imported")).toBe("weird-id--------quote----123");
    expect(safeDomToken("", "imported")).toBe("imported");
    expect(safeDomToken("中文 <> /", "imported")).toBe("-------");
  });

  it("uses crypto UUIDs when creating block ids", () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "11111111-2222-4333-8444-555555555555" },
    });

    expect(makeId()).toBe("block-11111111-2222-4333-8444-555555555555");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  });

  it("falls back to timestamp ids when crypto UUIDs are unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1778600000000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });

    expect(makeId()).toMatch(/^block-1778600000000-[a-z0-9]+-[a-z0-9]+-0$/);

    dateSpy.mockRestore();
    randomSpy.mockRestore();
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  });

  it("detects overlapping blocks", () => {
    const overlaps = findOverlaps([
      { id: "a", start: "09:00", end: "10:00" },
      { id: "b", start: "09:45", end: "11:00" },
      { id: "c", start: "12:00", end: "13:00" },
    ]);

    expect([...overlaps].sort()).toEqual(["a", "b"]);
  });

  it("detects non-adjacent overlapping blocks", () => {
    const overlaps = findOverlaps([
      { id: "a", start: "09:00", end: "14:00" },
      { id: "b", start: "10:00", end: "11:00" },
      { id: "c", start: "12:00", end: "15:00" },
    ]);

    expect([...overlaps].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns overlap details with conflicting block info", () => {
    const details = getOverlapDetails([
      { id: "a", title: "早会", start: "09:00", end: "10:00" },
      { id: "b", title: "评审", start: "09:30", end: "11:00" },
      { id: "c", title: "午餐", start: "12:00", end: "13:00" },
    ]);

    expect(details.get("a")).toHaveLength(1);
    expect(details.get("a")[0].id).toBe("b");
    expect(details.get("b")).toHaveLength(1);
    expect(details.get("b")[0].id).toBe("a");
    expect(details.get("c")).toBeUndefined();
  });

  it("ignores invalid blocks when detecting overlaps", () => {
    const overlaps = findOverlaps([
      { id: "bad", start: "", end: "11:00" },
      { id: "a", start: "09:00", end: "10:00" },
      { id: "b", start: "10:00", end: "11:00" },
    ]);

    expect([...overlaps]).toEqual([]);
  });

  it("finds the active block for a supplied time", () => {
    const active = getActiveBlock(
      [{ id: "a", start: "09:00", end: "10:00" }],
      new Date("2026-05-12T09:30:00"),
    );

    expect(active.id).toBe("a");
  });

  it("ignores completed and skipped blocks when finding the active block", () => {
    const active = getActiveBlock(
      [
        { id: "done", start: "09:00", end: "10:00", status: "done" },
        { id: "planned", start: "09:00", end: "10:00", status: "planned" },
      ],
      new Date("2026-05-12T09:30:00"),
    );

    expect(active.id).toBe("planned");
  });

  it("ignores invalid blocks when finding active and next blocks", () => {
    expect(
      getActiveBlock(
        [
          { id: "bad", start: "", end: "10:00", status: "planned" },
          { id: "valid", start: "09:00", end: "10:00", status: "planned" },
        ],
        new Date("2026-05-12T09:30:00"),
      ).id,
    ).toBe("valid");
    expect(
      getNextBlock(
        [
          { id: "bad", start: "", end: "11:00", status: "planned" },
          { id: "valid", start: "12:00", end: "13:00", status: "planned" },
        ],
        new Date("2026-05-12T10:30:00"),
      ).id,
    ).toBe("valid");
  });

  it("finds the next block for a supplied time", () => {
    const next = getNextBlock(
      [
        { id: "a", start: "09:00", end: "10:00" },
        { id: "b", start: "11:00", end: "12:00" },
      ],
      new Date("2026-05-12T10:30:00"),
    );

    expect(next.id).toBe("b");
  });

  it("ignores completed and skipped blocks when finding the next block", () => {
    const next = getNextBlock(
      [
        { id: "done", start: "11:00", end: "12:00", status: "done" },
        { id: "skipped", start: "12:00", end: "13:00", status: "skipped" },
        { id: "planned", start: "13:00", end: "14:00", status: "planned" },
      ],
      new Date("2026-05-12T10:30:00"),
    );

    expect(next.id).toBe("planned");
  });

  it("rounds up to a minute step", () => {
    expect(roundUpToStep(9 * 60 + 2, 15)).toBe(9 * 60 + 15);
  });

  it("suggests an open slot around existing blocks", () => {
    expect(
      findOpenSlot(
        [
          { id: "a", start: "09:00", end: "10:00" },
          { id: "b", start: "11:00", end: "12:00" },
        ],
        10 * 60,
        45,
      ),
    ).toEqual({ start: "10:00", end: "10:45" });
  });

  it("keeps the requested duration when suggesting larger open slots", () => {
    expect(
      findOpenSlot(
        [
          { id: "a", start: "09:00", end: "11:00" },
          { id: "b", start: "14:00", end: "16:00" },
        ],
        9 * 60,
        180,
        { allowPastFallback: true },
      ),
    ).toEqual({ start: "11:00", end: "14:00" });
  });

  it("ignores invalid blocks when suggesting an open slot", () => {
    expect(
      findOpenSlot(
        [
          { id: "bad", start: "", end: "23:00" },
          { id: "a", start: "09:00", end: "10:00" },
        ],
        10 * 60,
        45,
      ),
    ).toEqual({ start: "10:00", end: "10:45" });
  });

  it("returns no open slot when the planning day is full", () => {
    expect(findOpenSlot([{ id: "all-day", start: "06:00", end: "23:00" }], 9 * 60, 30)).toBeNull();
  });

  it("can avoid suggesting past slots after the preferred time", () => {
    expect(findOpenSlot([], 23 * 60 + 30, 60, { allowPastFallback: false })).toBeNull();
    expect(findOpenSlot([], 23 * 60 + 30, 60)).toEqual({ start: "22:00", end: "23:00" });
  });

  it("summarizes planned and completed minutes", () => {
    expect(
      getPlanStats([
        { start: "09:00", end: "10:00", status: "done" },
        { start: "10:00", end: "10:30", status: "planned" },
      ]),
    ).toMatchObject({ plannedMinutes: 90, doneMinutes: 60, totalBlocks: 2, doneBlocks: 1 });
  });

  it("does not count invalid block durations in planned or completed minutes", () => {
    expect(
      getPlanStats([
        { start: "", end: "10:00", status: "done" },
        { start: "10:00", end: "11:00", status: "done" },
      ]),
    ).toMatchObject({ plannedMinutes: 60, doneMinutes: 60, totalBlocks: 2, doneBlocks: 1 });
  });

  it("lays out overlapping blocks into columns", () => {
    const layout = computeOverlapLayout([
      { id: "a", start: "09:00", end: "14:00" },
      { id: "b", start: "10:00", end: "11:00" },
      { id: "c", start: "12:00", end: "15:00" },
    ]);

    expect(layout.get("a")).toEqual({ column: 0, totalColumns: 2 });
    expect(layout.get("b")).toEqual({ column: 1, totalColumns: 2 });
    expect(layout.get("c")).toEqual({ column: 1, totalColumns: 2 });
  });

  it("places non-overlapping blocks in a single column", () => {
    const layout = computeOverlapLayout([
      { id: "a", start: "09:00", end: "10:00" },
      { id: "b", start: "10:00", end: "11:00" },
      { id: "c", start: "11:00", end: "12:00" },
    ]);

    expect(layout.get("a")).toEqual({ column: 0, totalColumns: 1 });
    expect(layout.get("b")).toEqual({ column: 0, totalColumns: 1 });
    expect(layout.get("c")).toEqual({ column: 0, totalColumns: 1 });
  });

  it("computes proportional timeline styles for blocks", () => {
    const style = blockTimelineStyle("09:00", "11:00");
    expect(parseFloat(style.top)).toBeCloseTo(17.65, 1);
    expect(parseFloat(style.height)).toBeCloseTo(11.76, 1);
  });

  it("clamps timeline styles within visible bounds", () => {
    const style = blockTimelineStyle("23:30", "23:59");
    expect(parseFloat(style.top)).toBeGreaterThanOrEqual(2);
    expect(parseFloat(style.top)).toBeLessThanOrEqual(96);
  });

  it("keeps invalid timeline styles visible and finite", () => {
    const style = blockTimelineStyle("", "10:00");
    expect(style.top).toBe("2%");
    expect(style.height).toBe("3.5%");
    expect(Number.isFinite(parseFloat(style.top))).toBe(true);
    expect(Number.isFinite(parseFloat(style.height))).toBe(true);
  });

  it("round-trips exported plans through import", () => {
    const plan = createSeedPlan();
    const imported = importPlan(exportPlan(plan));
    const day = getDay(imported);

    expect(imported.selectedDate).toBe(plan.selectedDate);
    expect(day.blocks).toHaveLength(getDay(plan).blocks.length);
    expect(day.blocks[0].title).toBe("深度规划");
  });

  it("builds stable export file names with plan date and timestamp", () => {
    expect(exportFileName({ selectedDate: "2026-05-14" }, new Date(2026, 4, 13, 1, 42, 0))).toBe(
      "time-goalie-2026-05-14_20260513_01-42-00.json",
    );
  });

  it("does not throw when browser storage rejects saving", () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem() {
          throw new Error("quota exceeded");
        },
      },
    });

    expect(savePlan(createSeedPlan())).toBe(false);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("persists and restores a date-keyed plan from local storage", () => {
    const originalStorage = globalThis.localStorage;
    const values = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key) {
          return values.get(key) || null;
        },
        setItem(key, value) {
          values.set(key, value);
        },
      },
    });

    const selectedDate = addDaysISO(todayISO(), 1);
    const plan = {
      focusMode: true,
      selectedDate,
      days: {
        [selectedDate]: {
          goal: "  守住明天  ",
          blocks: [{ id: "a", title: "  早读  ", start: "07:30", end: "08:00", status: "done" }],
        },
      },
    };

    expect(savePlan(plan)).toBe(true);
    const restored = loadPlan();
    expect(restored.focusMode).toBe(true);
    expect(restored.selectedDate).toBe(selectedDate);
    expect(getDay(restored).goal).toBe("守住明天");
    expect(getDay(restored).blocks[0]).toMatchObject({ title: "早读", status: "done" });

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("debounces plan persistence and flushes the latest plan", () => {
    vi.useFakeTimers();
    const saved = [];
    const saver = createDebouncedSaver((plan) => {
      saved.push(plan.selectedDate);
      return true;
    }, 300);

    saver.schedule({ selectedDate: "2026-05-13" });
    saver.schedule({ selectedDate: "2026-05-14" });
    vi.advanceTimersByTime(299);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual(["2026-05-14"]);

    saver.schedule({ selectedDate: "2026-05-15" });
    expect(saver.flush()).toBe(true);
    expect(saved).toEqual(["2026-05-14", "2026-05-15"]);
    vi.useRealTimers();
  });

  it("reports debounced save failures once the write is attempted", () => {
    vi.useFakeTimers();
    const onFailure = vi.fn();
    const saver = createDebouncedSaver(() => false, 100);

    saver.schedule({ selectedDate: "2026-05-13" }, onFailure);
    expect(onFailure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFailure).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("opens stale saved plans on today without deleting the old day", () => {
    const restored = revivePlanForToday(
      {
        focusMode: true,
        selectedDate: "2026-05-12",
        days: {
          "2026-05-12": {
            goal: "昨天的复盘",
            blocks: [{ id: "old", title: "旧任务", start: "09:00", end: "10:00" }],
          },
        },
      },
      "2026-05-13",
    );

    expect(restored.focusMode).toBe(true);
    expect(restored.selectedDate).toBe("2026-05-13");
    expect(getDay(restored, "2026-05-12").goal).toBe("昨天的复盘");
    expect(getDay(restored, "2026-05-13").blocks).toHaveLength(3);
  });

  it("opens stale saved plans on the existing today day when present", () => {
    const restored = revivePlanForToday(
      {
        selectedDate: "2026-05-12",
        days: {
          "2026-05-12": {
            goal: "昨天",
            blocks: [{ id: "old", title: "旧任务", start: "09:00", end: "10:00" }],
          },
          "2026-05-13": {
            goal: "已经规划好的今天",
            blocks: [{ id: "today", title: "今日任务", start: "14:00", end: "15:00" }],
          },
        },
      },
      "2026-05-13",
    );

    expect(restored.selectedDate).toBe("2026-05-13");
    expect(getDay(restored).goal).toBe("已经规划好的今天");
    expect(getDay(restored).blocks.map((block) => block.id)).toEqual(["today"]);
  });

  it("keeps future saved plans selected", () => {
    const restored = revivePlanForToday(
      {
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "明天",
            blocks: [{ id: "future", title: "未来任务", start: "09:00", end: "10:00" }],
          },
        },
      },
      "2026-05-13",
    );

    expect(restored.selectedDate).toBe("2026-05-14");
    expect(getDay(restored).blocks[0].id).toBe("future");
  });

  it("keeps a future selected date empty when it has no saved day yet", () => {
    const restored = revivePlanForToday(
      {
        selectedDate: "2026-05-20",
        days: {
          "2026-05-13": {
            goal: "今天模板不该复制过去",
            blocks: [{ id: "today", title: "今日任务", start: "09:00", end: "10:00" }],
          },
        },
      },
      "2026-05-13",
    );

    expect(restored.selectedDate).toBe("2026-05-20");
    expect(getDay(restored).goal).toBe("守住这一天最重要的 3 件事");
    expect(getDay(restored).blocks).toEqual([]);
    expect(getDay(restored, "2026-05-13").blocks.map((block) => block.id)).toEqual(["today"]);
  });

  it("ensures the selected imported date always has its own day bucket", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-20",
        days: {
          "2026-05-13": {
            goal: "不要复制到未来",
            blocks: [{ id: "today", title: "今日任务", start: "09:00", end: "10:00" }],
          },
        },
      }),
    );

    expect(Object.keys(imported.days).sort()).toEqual(["2026-05-13", "2026-05-20"]);
    expect(getDay(imported, "2026-05-20")).toEqual(createEmptyDay());
  });

  it("falls back to a seed plan when stored data is malformed", () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          return "{bad json";
        },
      },
    });

    const restored = loadPlan();
    expect(isISODate(restored.selectedDate)).toBe(true);
    expect(getDay(restored).goal).toBe("守住今天最重要的 3 件事");

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("falls back to a seed plan when stored data has no plan shape", () => {
    const originalStorage = globalThis.localStorage;
    for (const raw of [
      "{}",
      "[]",
      '{"selectedDate":"2026-05-14"}',
      '{"selectedDate":"2026-05-14","days":{}}',
      '{"selectedDate":"2026-05-14","days":{"not-a-date":{"goal":"bad","blocks":[]}}}',
    ]) {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem() {
            return raw;
          },
        },
      });

      const restored = loadPlan();
      expect(getDay(restored).goal).toBe("守住今天最重要的 3 件事");
      expect(getDay(restored).blocks).toHaveLength(3);
    }

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("falls back to a seed plan when reading browser storage throws", () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("storage blocked");
        },
      },
    });

    const restored = loadPlan();
    expect(isISODate(restored.selectedDate)).toBe(true);
    expect(getDay(restored).blocks).toHaveLength(3);

    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("migrates legacy single-day plans into date-keyed storage", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        goal: "明天守门",
        blocks: [{ id: "legacy", title: "旧规划", start: "08:00", end: "09:00", status: "planned" }],
      }),
    );

    expect(getDay(imported, "2026-05-14").goal).toBe("明天守门");
    expect(getDay(imported, "2026-05-14").blocks[0].title).toBe("旧规划");
    expect(imported.blocks).toBeUndefined();
    expect(imported.goal).toBeUndefined();
  });

  it("still accepts legacy empty block lists as a valid single-day plan", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        goal: "旧版空规划",
        blocks: [],
      }),
    );

    expect(imported.selectedDate).toBe("2026-05-14");
    expect(getDay(imported, "2026-05-14")).toEqual({
      goal: "旧版空规划",
      blocks: [],
    });
  });

  it("does not let legacy fields overwrite an existing date-keyed day", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        goal: "旧目标",
        blocks: [{ id: "legacy", title: "旧任务", start: "08:00", end: "09:00" }],
        days: {
          "2026-05-14": {
            goal: "新结构目标",
            blocks: [{ id: "current", title: "新结构任务", start: "10:00", end: "11:00" }],
          },
        },
      }),
    );

    expect(getDay(imported).goal).toBe("新结构目标");
    expect(getDay(imported).blocks.map((block) => block.id)).toEqual(["current"]);
  });

  it("keeps imported days isolated by date", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "五月十四",
            blocks: [{ id: "a", title: "十四任务", start: "09:00", end: "10:00" }],
          },
          "2026-05-15": {
            goal: "五月十五",
            blocks: [{ id: "b", title: "十五任务", start: "11:00", end: "12:00" }],
          },
        },
      }),
    );

    expect(getDay(imported, "2026-05-14").blocks[0].title).toBe("十四任务");
    expect(getDay(imported, "2026-05-15").blocks[0].title).toBe("十五任务");
    expect(getDay(imported, "2026-05-16").blocks).toEqual([]);
  });

  it("sanitizes imported days and blocks before rendering", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "not-a-date": {
            goal: "bad",
            blocks: [{ title: "不该出现", start: "09:00", end: "10:00" }],
          },
          "2026-99-99": {
            goal: "bad",
            blocks: [{ title: "也不该出现", start: "09:00", end: "10:00" }],
          },
          "2026-05-14": {
            goal: "  当日目标  ",
            blocks: [
              {
                id: "good",
                title: "  干净任务  ",
                note: "  备注  ",
                start: "09:00",
                end: "10:00",
                type: "bad",
                status: "weird",
              },
              { id: "empty-title", title: "   ", start: "11:00", end: "12:00" },
              { id: "bad-time", title: "坏时间", start: "9", end: "12:00" },
              { id: "impossible-time", title: "不存在时间", start: "99:99", end: "12:00" },
            ],
          },
        },
      }),
    );

    expect(imported.days["not-a-date"]).toBeUndefined();
    expect(Object.keys(imported.days)).toEqual(["2026-05-14"]);
    expect(getDay(imported, "2026-05-14")).toEqual({
      goal: "当日目标",
      blocks: [
        {
          id: "good",
          title: "干净任务",
          note: "备注",
          start: "09:00",
          end: "10:00",
          type: "deep",
          status: "planned",
        },
      ],
    });
  });

  it("uses fallback copy when imported goals are blank after trimming", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "       ",
            blocks: [{ id: "blank-goal", title: "有效任务", start: "09:00", end: "10:00" }],
          },
        },
      }),
    );

    expect(getDay(imported).goal).toBe("守住这一天最重要的 3 件事");
    expect(getDay(imported).blocks.map((block) => block.id)).toEqual(["blank-goal"]);
  });

  it("falls back to the first valid imported day when selectedDate is invalid", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-99-99",
        days: {
          "2026-05-14": {
            goal: "可用日期",
            blocks: [{ title: "可用任务", start: "09:00", end: "10:00" }],
          },
        },
      }),
    );

    expect(imported.selectedDate).toBe("2026-05-14");
    expect(getDay(imported).blocks[0].title).toBe("可用任务");
  });

  it("deduplicates imported block ids within a day", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "重复 ID",
            blocks: [
              { id: "same", title: "任务一", start: "09:00", end: "10:00" },
              { id: "same", title: "任务二", start: "10:00", end: "11:00" },
            ],
          },
        },
      }),
    );

    expect(getDay(imported).blocks.map((block) => block.id)).toEqual(["same", "same-1"]);
  });

  it("creates unique imported ids for blocks without ids", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "缺少 ID",
            blocks: [
              { title: "任务一", start: "09:00", end: "10:00" },
              { title: "任务二", start: "10:00", end: "11:00" },
              { title: "任务三", start: "11:00", end: "12:00" },
            ],
          },
        },
      }),
    );

    const ids = getDay(imported).blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.startsWith("imported-"))).toBe(true);
  });

  it("keeps deduplicating imported block ids when suffixes also collide", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "重复后缀",
            blocks: [
              { id: "same", title: "任务一", start: "09:00", end: "10:00" },
              { id: "same", title: "任务二", start: "10:00", end: "11:00" },
              { id: "same-1", title: "任务三", start: "11:00", end: "12:00" },
              { id: "same", title: "任务四", start: "12:00", end: "13:00" },
            ],
          },
        },
      }),
    );

    expect(new Set(getDay(imported).blocks.map((block) => block.id)).size).toBe(4);
  });

  it("limits imported block id length before rendering", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "过长 ID",
            blocks: [{ id: "x".repeat(800), title: "长 ID 块", start: "09:00", end: "10:00" }],
          },
        },
      }),
    );

    expect(getDay(imported).blocks[0].id).toHaveLength(96);
  });

  it("limits imported text field lengths before rendering", () => {
    const imported = importPlan(
      JSON.stringify({
        selectedDate: "2026-05-14",
        days: {
          "2026-05-14": {
            goal: "目标".repeat(800),
            blocks: [
              {
                id: "long-text",
                title: "标题".repeat(200),
                note: "备注".repeat(400),
                start: "09:00",
                end: "10:00",
              },
            ],
          },
        },
      }),
    );

    expect(getDay(imported).goal).toHaveLength(800);
    expect(getDay(imported).blocks[0].title).toHaveLength(160);
    expect(getDay(imported).blocks[0].note).toHaveLength(500);
  });

  it("uses date-neutral copy for newly opened empty days", () => {
    expect(createEmptyDay().goal).toBe("守住这一天最重要的 3 件事");
  });

  it("rejects invalid imported plan data", () => {
    expect(() => importPlan('{"plan":{"blocks":"bad"}}')).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan('{"plan":{"days":"bad"}}')).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan('{"plan":{"days":[]}}')).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan('{"plan":{"days":{}}}')).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan('{"plan":{"days":{"not-a-date":{"goal":"bad","blocks":[]}}}}')).toThrow(
      "导入文件不是 Time Goalie 规划数据",
    );
    expect(() => importPlan("{}")).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan("[]")).toThrow("导入文件不是 Time Goalie 规划数据");
    expect(() => importPlan('{"plan":null}')).toThrow("导入文件不是 Time Goalie 规划数据");
  });

  it("shows a friendly error for malformed JSON imports", () => {
    expect(() => importPlan("{bad json")).toThrow("JSON 格式不正确，请检查导入内容");
  });

  it("restores and syncs the selected planning date through the URL", () => {
    const originalWindow = globalThis.window;
    let href = "https://time-goalie.local/?date=2026-05-20";
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get location() {
          return new URL(href);
        },
        history: {
          replaceState: vi.fn((_, __, nextPath) => {
            href = `https://time-goalie.local${nextPath}`;
          }),
        },
      },
    });

    expect(getDateFromURL()).toBe("2026-05-20");

    const plan = applyDateFromURL({
      ...createSeedPlan(),
      selectedDate: "2026-05-15",
      days: { "2026-05-15": createSeedDay() },
    });
    expect(plan.selectedDate).toBe("2026-05-20");
    expect(plan.days["2026-05-20"]).toEqual(createEmptyDay());

    syncDateToURL("2026-05-21");
    expect(globalThis.window.history.replaceState).toHaveBeenCalledWith(null, "", "/?date=2026-05-21");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });
});
