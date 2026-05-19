import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createIcs,
  deliverDueReminders,
  fallbackParse,
  mergeReminders,
  normalizeSettings,
  readEnvFile,
  requeueFailedReminders,
  saveSetupConfig,
  sanitizePlanDraft,
  scheduleFromPlan,
  sendBark,
  skipStalePendingReminders,
} from "./core.mjs";

const plan = {
  selectedDate: "2026-05-16",
  days: {
    "2026-05-16": {
      goal: "交付闭环版",
      blocks: [
        {
          id: "block-1",
          title: "打通提醒",
          note: "Bark 和站内提醒",
          start: "09:00",
          end: "10:00",
          type: "deep",
          status: "planned",
        },
      ],
    },
  },
};

describe("closed-loop core", () => {
  it("creates a fallback draft from messy input", () => {
    const draft = fallbackParse("写方案；测试提醒\n复盘", "2026-05-16");

    expect(draft.goal).toBe("写方案");
    expect(draft.blocks).toHaveLength(3);
    expect(draft.blocks[0]).toMatchObject({ start: "09:00", end: "10:00" });
  });

  it("sanitizes invalid AI draft times and caps unsafe fields", () => {
    const draft = sanitizePlanDraft(
      {
        goal: "A".repeat(300),
        blocks: [{ title: "深度工作", start: "99:99", end: "08:00", type: "unknown" }],
        reviewQuestions: ["复盘什么？"],
      },
      "2026-05-16",
    );

    expect(draft.goal).toHaveLength(240);
    expect(draft.blocks[0]).toMatchObject({ start: "09:00", end: "09:45", type: "deep" });
    expect(draft.reviewQuestions).toEqual(["复盘什么？"]);
  });

  it("schedules deduped reminders and respects quiet hours", () => {
    const settings = normalizeSettings({
      channels: { bark: true, inApp: true },
      bark: { key: "abc" },
      reminderLeadMinutes: [10, 0, 10],
      quietHours: { enabled: true, start: "08:45", end: "09:05" },
    });

    const reminders = scheduleFromPlan(plan, settings, "2026-05-16");
    const merged = mergeReminders(reminders, reminders);

    expect(reminders.some((reminder) => reminder.kind === "overdue" && reminder.channel === "bark")).toBe(
      true,
    );
    expect(reminders.some((reminder) => reminder.blockId === "block-1" && reminder.kind === "start")).toBe(
      false,
    );
    expect(new Set(merged.map((reminder) => reminder.id)).size).toBe(merged.length);
  });

  it("delivers due in-app reminders idempotently", async () => {
    const store = {
      settings: normalizeSettings({ channels: { inApp: true } }),
      reminders: [
        {
          id: "due",
          planDate: "2026-05-16",
          blockId: "block-1",
          kind: "start",
          channel: "inApp",
          fireAt: "2026-05-16T09:00:00.000Z",
          title: "开始",
          body: "执行",
          status: "pending",
          retryCount: 0,
        },
      ],
      deliveryLog: [],
      pushSubscriptions: [],
    };

    const result = await deliverDueReminders(store, new Date("2026-05-16T09:01:00.000Z"));
    const second = await deliverDueReminders(store, new Date("2026-05-16T09:02:00.000Z"));

    expect(result).toEqual({ due: 1, delivered: 1 });
    expect(second).toEqual({ due: 0, delivered: 0 });
    expect(store.reminders[0].status).toBe("delivered");
  });

  it("keeps retrying failed Bark reminders before marking failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad device key" }),
    );
    const store = {
      settings: normalizeSettings({ channels: { bark: true }, bark: { key: "bad-key" } }),
      reminders: [
        {
          id: "bark-due",
          planDate: "2026-05-16",
          blockId: "block-1",
          kind: "start",
          channel: "bark",
          fireAt: "2026-05-16T09:00:00.000Z",
          title: "开始",
          body: "执行",
          status: "pending",
          retryCount: 0,
        },
      ],
      deliveryLog: [],
      pushSubscriptions: [],
    };

    await deliverDueReminders(store, new Date("2026-05-16T09:01:00.000Z"));
    expect(store.reminders[0]).toMatchObject({ status: "pending", retryCount: 1 });
    await deliverDueReminders(store, new Date("2026-05-16T09:02:00.000Z"));
    await deliverDueReminders(store, new Date("2026-05-16T09:03:00.000Z"));
    expect(store.reminders[0]).toMatchObject({ status: "failed", retryCount: 3 });
    expect(store.deliveryLog.at(-1).message).toContain("bad device key");
    vi.unstubAllGlobals();
  });

  it("can requeue failed reminders and skip stale pending reminders", () => {
    const store = {
      reminders: [
        {
          id: "failed",
          status: "failed",
          retryCount: 3,
          lastError: "bad key",
          fireAt: "2026-05-16T09:00:00.000Z",
        },
        {
          id: "stale",
          status: "pending",
          retryCount: 0,
          fireAt: "2026-05-16T08:00:00.000Z",
        },
        {
          id: "future",
          status: "pending",
          retryCount: 0,
          fireAt: "2026-05-16T12:00:00.000Z",
        },
      ],
    };

    expect(requeueFailedReminders(store, new Date("2026-05-16T10:02:00.000Z"))).toBe(1);
    expect(store.reminders[0]).toMatchObject({
      status: "pending",
      retryCount: 0,
      lastError: "",
      fireAt: "2026-05-16T10:02:00.000Z",
    });

    expect(skipStalePendingReminders(store, new Date("2026-05-16T10:01:00.000Z"))).toBe(1);
    expect(store.reminders.find((reminder) => reminder.id === "failed")).toMatchObject({ status: "pending" });
    expect(store.reminders.find((reminder) => reminder.id === "future")).toMatchObject({
      status: "pending",
    });
  });

  it("builds Bark URLs safely", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await sendBark(
      { key: "key/with/slash", server: "https://api.day.app/", level: "timeSensitive", sound: "bell" },
      "开始 守门",
      "写方案",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("https://api.day.app/key%2Fwith%2Fslash/");
    expect(fetchSpy.mock.calls[0][0]).toContain("%E5%BC%80%E5%A7%8B%20%E5%AE%88%E9%97%A8");
    expect(fetchSpy.mock.calls[0][0]).toContain("level=timeSensitive");
    expect(fetchSpy.mock.calls[0][0]).toContain("sound=bell");
    vi.unstubAllGlobals();
  });

  it("surfaces Bark response details when a test send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad device key" }),
    );

    await expect(sendBark({ key: "bad-key", server: "https://api.day.app" }, "测试", "提醒")).rejects.toThrow(
      "bad device key",
    );
    vi.unstubAllGlobals();
  });

  it("exports a valid calendar file", () => {
    const ics = createIcs(plan, "2026-05-16");

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:打通提醒");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("saves first-run setup into env and live settings", async () => {
    const previousEnv = {
      AI_API_KEY: process.env.AI_API_KEY,
      AI_BASE_URL: process.env.AI_BASE_URL,
      AI_MODEL: process.env.AI_MODEL,
      BARK_KEY: process.env.BARK_KEY,
      BARK_SERVER: process.env.BARK_SERVER,
    };
    for (const key of Object.keys(previousEnv)) delete process.env[key];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "time-goalie-"));
    const envFile = path.join(dir, ".env.local");
    const store = {
      settings: normalizeSettings({}),
      setup: { completedAt: null },
    };

    try {
      await saveSetupConfig(
        store,
        {
          aiApiKey: "sk-local-test",
          aiBaseUrl: "https://ai.example/v1",
          aiModel: "planner-model",
          barkKey: "bark-test",
          barkServer: "https://api.day.app",
          channels: { bark: true, inApp: true },
        },
        envFile,
      );

      const env = await readEnvFile(envFile);
      expect(env).toMatchObject({
        AI_API_KEY: "sk-local-test",
        AI_BASE_URL: "https://ai.example/v1",
        AI_MODEL: "planner-model",
        BARK_KEY: "bark-test",
      });
      expect(process.env.AI_MODEL).toBe("planner-model");
      expect(store.settings.bark.key).toBe("bark-test");
      expect(store.setup.completedAt).toBeTruthy();
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
