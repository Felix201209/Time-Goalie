import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRescuePacket,
  buildSnapshot,
  classifyRisk,
  createEventsFromSnapshot,
  deliverDueEvents,
  mergeEvents,
  parseFrontmatter,
  sendBark,
} from "./homework.mjs";

describe("homework goalie core", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("parses Obsidian assignment frontmatter", () => {
    expect(parseFrontmatter("---\ntitle: Essay\nstatus: not-started\n---\nbody")).toEqual({
      title: "Essay",
      status: "not-started",
    });
  });

  it("builds a snapshot from Homework Vault assignments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "homework-goalie-"));
    const assignments = path.join(root, "Assignments");
    await mkdir(assignments);
    await writeFile(
      path.join(assignments, "2026-05-26 Essay.md"),
      [
        "---",
        "title: History Essay",
        "subject: Individuals & Societies",
        "due: 2026-05-25",
        "status: not-started",
        "priority: high",
        "managebac_id: 123",
        "managebac_state: pending",
        "managebac_url: https://ibwya.managebac.cn/student/classes/1/core_tasks/123",
        "---",
        "",
        "## Requirements",
        "- Write an essay with evidence.",
        "",
        "## Progress",
        "- No progress yet.",
        "",
        "## Submission",
        "- Upload Submission: https://ibwya.managebac.cn/student/classes/1/core_tasks/123/dropbox",
      ].join("\n"),
    );

    const snapshot = await buildSnapshot({
      vaultPath: root,
      now: new Date("2026-05-25T12:00:00+08:00"),
    });

    expect(snapshot.assignments).toHaveLength(1);
    expect(snapshot.assignments[0]).toMatchObject({
      id: "123",
      riskLevel: "urgent",
      submissionUrl: "https://ibwya.managebac.cn/student/classes/1/core_tasks/123/dropbox",
    });
  });

  it("classifies impossible near-deadline big work as rescue", () => {
    const risk = classifyRisk(
      {
        title: "Robotics and Innovation - Creating the solution(C)",
        subject: "Coding",
        due: "2026-05-25",
        status: "not-started",
        priority: "high",
        managebacState: "pending",
        requirementsSummary: "Build a process journal and final solution evidence.",
        localProgressSignals: { hasSubstantialDraft: false },
      },
      new Date("2026-05-25T20:30:00+08:00"),
    );

    expect(risk).toMatchObject({ riskLevel: "rescue", rescueEligible: true, bigWork: true });
  });

  it("keeps graded rescue packets in confirmation-only mode", () => {
    const packet = buildRescuePacket({
      id: "a1",
      title: "Summative Essay",
      subject: "English",
      due: "2026-05-25",
      riskLevel: "rescue",
      requirementsSummary: "Write an essay.",
      localProgressSignals: { hasSubstantialDraft: false },
      canAutoAdmin: false,
      submissionUrl: "https://ibwya.managebac.cn/dropbox",
      managebacUrl: "https://ibwya.managebac.cn/task",
    });

    expect(packet.allowedActions).toContain("submit-after-felix-confirmation");
    expect(packet.blockedActions).toContain("unconfirmed-graded-submission");
  });

  it("dedupes events and preserves delivered ones", () => {
    const existing = [{ id: "x", status: "delivered", fireAt: "2026-05-25T01:00:00.000Z" }];
    const incoming = [{ id: "x", status: "pending", fireAt: "2026-05-25T02:00:00.000Z" }];
    expect(mergeEvents(existing, incoming)).toEqual(existing);
  });

  it("creates immediate Bark events for urgent assignments", () => {
    const snapshot = {
      generatedAt: "2026-05-25T00:00:00.000Z",
      assignments: [
        {
          id: "a",
          title: "Essay",
          subject: "English",
          due: "2026-05-25",
          status: "not-started",
          managebacState: "pending",
          riskLevel: "critical",
          recommendedNextAction: "提交",
          submissionUrl: "",
        },
      ],
    };
    const events = createEventsFromSnapshot(snapshot, undefined, new Date("2026-05-25T10:00:00+08:00"));
    expect(events.some((event) => event.kind === "risk-now" && event.assignmentId === "a")).toBe(true);
  });

  it("sends Bark and records delivery state", async () => {
    const state = {
      events: [
        {
          id: "e1",
          title: "Title",
          body: "Body",
          fireAt: "2026-05-25T10:00:00.000Z",
          status: "pending",
          retryCount: 0,
        },
      ],
      deliveryLog: [],
    };
    await deliverDueEvents(
      state,
      { bark: { key: "abc", server: "https://api.day.app", archive: true } },
      new Date("2026-05-25T10:00:01.000Z"),
    );
    expect(state.events[0].status).toBe("delivered");
    expect(fetchSpy.mock.calls[0][0]).toContain("https://api.day.app/abc/");
  });

  it("surfaces Bark HTTP failures", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 400, text: async () => "bad key" });
    await expect(sendBark({ key: "bad", server: "https://api.day.app" }, "T", "B")).rejects.toThrow(
      "Bark HTTP 400",
    );
  });
});
