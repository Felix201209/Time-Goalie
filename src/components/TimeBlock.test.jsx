import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimeBlock } from "./TimeBlock.jsx";

const baseBlock = {
  id: "block-test",
  title: "非常长的时间块标题".repeat(8),
  note: "备注",
  start: "09:00",
  end: "10:00",
  type: "deep",
  status: "planned",
};

describe("TimeBlock component", () => {
  it("renders compact accessible names for long titles", () => {
    const html = renderToStaticMarkup(
      <TimeBlock
        block={baseBlock}
        blockIndex={0}
        active={false}
        overlapping={false}
        overlapDetails={undefined}
        selected={false}
        dimmed={false}
        pomodoroEndTime={null}
        onPatch={vi.fn()}
        onStatus={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onToggleSelect={vi.fn()}
        onTogglePomodoro={undefined}
        onPomodoroExpire={vi.fn()}
        registerActionRef={vi.fn()}
        registerTitleRef={vi.fn()}
      />,
    );

    expect(html).toMatch(/aria-label="[^"]+… 完成"/);
    expect(html).toContain('maxLength="160"');
  });

  it("marks invalid time ranges and disables status actions", () => {
    const html = renderToStaticMarkup(
      <TimeBlock
        block={{ ...baseBlock, start: "10:00", end: "09:00" }}
        blockIndex={0}
        active={false}
        overlapping={false}
        overlapDetails={undefined}
        selected={false}
        dimmed={false}
        pomodoroEndTime={null}
        onPatch={vi.fn()}
        onStatus={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        onToggleSelect={vi.fn()}
        onTogglePomodoro={undefined}
        onPomodoroExpire={vi.fn()}
        registerActionRef={vi.fn()}
        registerTitleRef={vi.fn()}
      />,
    );

    expect(html).toContain("时间无效");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-describedby="block-warning-block-test-0"');
  });
});
