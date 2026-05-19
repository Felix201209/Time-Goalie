import { describe, expect, it } from "vitest";
import { CAPTURE_PRESETS, CLOSED_LOOP_TEMPLATES, createTemplateDraft } from "./closedLoop.js";

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
});
