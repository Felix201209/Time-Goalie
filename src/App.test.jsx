import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "./App.jsx";

describe("App shell", () => {
  it("renders the planning workspace and primary actions", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Time Goalie");
    expect(html).toContain("本周守门");
    expect(html).toContain("一周复盘");
    expect(html).toContain("接下来");
    expect(html).toContain("今日收口");
    expect(html).toContain("今日目标");
    expect(html).toContain("AI 收件箱");
    expect(html).toContain("万能记录");
    expect(html).toContain("读书");
    expect(html).toContain("配置");
    expect(html).toContain("提醒队列");
    expect(html).toContain("下周承接");
    expect(html).toContain("新时间块");
    expect(html).toContain("加入规划");
    expect(html).toContain("今日防线");
  });
});
