import { describe, expect, it } from "vitest";
import {
  CAPTURE_PRESETS,
  CLOSED_LOOP_TEMPLATES,
  createTemplateDraft,
  parseCaptureIntent,
} from "./closedLoop.js";

describe("closed loop templates", () => {
  it("ships a broad scene library for daily capture use cases", () => {
    expect(CLOSED_LOOP_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(["reading", "study", "project", "health", "finance", "social"]),
    );
    expect(CLOSED_LOOP_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(CAPTURE_PRESETS.some((preset) => preset.id === "tomorrow")).toBe(true);
  });

  it("creates a complete reading draft instead of a single prompt line", () => {
    const draft = createTemplateDraft("reading", "2026-05-17");

    expect(draft.goal).toContain("读书闭环");
    expect(draft.blocks).toHaveLength(5);
    expect(draft.blocks[0]).toMatchObject({
      title: "选书与页数",
      start: "09:00",
      end: "09:15",
      type: "deep",
    });
    expect(draft.reviewQuestions[0]).toContain("改变");
  });

  it("understands natural capture dates, times, and duration", () => {
    const intent = parseCaptureIntent("周五下午3点读书45分钟", {
      selectedDate: "2026-05-20",
      todayKey: "2026-05-20",
      preset: CAPTURE_PRESETS[0],
    });

    expect(intent).toMatchObject({
      targetDate: "2026-05-22",
      explicitTime: 15 * 60,
      duration: 45,
      hasExplicitDate: true,
      hasExplicitTime: true,
    });
    expect(intent.note).toContain("识别到 2026-05-22");
  });

  it("uses relative days from today for quick reminders", () => {
    const intent = parseCaptureIntent("明早8点带作业", {
      selectedDate: "2026-05-25",
      todayKey: "2026-05-20",
      preset: CAPTURE_PRESETS[0],
    });

    expect(intent.targetDate).toBe("2026-05-21");
    expect(intent.explicitTime).toBe(8 * 60);
  });
});
