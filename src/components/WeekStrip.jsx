import { useMemo } from "react";
import { addDaysISO, todayISO } from "../storage.js";
import { formatMinutes, getPlanStats, isValidTimeRange, normalizeBlocks, toMinutes } from "../utils.js";

const TYPE_DOTS = ["deep", "ship", "review", "admin"];

function weekdayLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("zh-CN", { weekday: "short" });
}

function dayNumber(iso) {
  const [, , d] = iso.split("-").map(Number);
  return d;
}

export function WeekStrip({
  selectedDate,
  days,
  onSelect,
  todayKey = todayISO(),
  missedCount = 0,
  overloadedCount = 0,
}) {
  const weekDays = useMemo(() => {
    const date = new Date(selectedDate);
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return Array.from({ length: 7 }, (_, index) => {
      const item = new Date(date);
      item.setDate(date.getDate() + mondayOffset + index);
      return todayISO(item);
    });
  }, [selectedDate]);
  const weekSummary = useMemo(() => {
    const stats = weekDays.map((date) => getPlanStats(normalizeBlocks(days?.[date]?.blocks || [])));
    const plannedMinutes = stats.reduce((sum, item) => sum + item.plannedMinutes, 0);
    const doneMinutes = stats.reduce((sum, item) => sum + item.doneMinutes, 0);
    const blocks = stats.reduce((sum, item) => sum + item.totalBlocks, 0);
    const completion = plannedMinutes ? Math.round((doneMinutes / plannedMinutes) * 100) : 0;
    return { plannedMinutes, blocks, completion };
  }, [days, weekDays]);
  const weekHorizon = useMemo(
    () =>
      weekDays.map((date) => {
        const blocks = normalizeBlocks(days?.[date]?.blocks || []);
        const timedBlocks = blocks
          .filter((block) => isValidTimeRange(block.start, block.end))
          .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
        const stats = getPlanStats(timedBlocks);
        const unfinished = timedBlocks.filter((block) => block.status !== "done").length;
        return {
          date,
          blocks: timedBlocks,
          stats,
          unfinished,
          loadLabel: stats.plannedMinutes ? formatMinutes(stats.plannedMinutes) : "空档",
        };
      }),
    [days, weekDays],
  );

  return (
    <section className="week-board" aria-label="一周规划总览">
      <div className="week-board-copy">
        <div>
          <span>本周守门</span>
          <strong>
            {weekSummary.plannedMinutes ? `${Math.round(weekSummary.plannedMinutes / 60)}h` : "未排期"}
          </strong>
          <small>
            {weekSummary.blocks} 块 · 完成 {weekSummary.completion}%
          </small>
          <div className="week-alerts" aria-label="本周风险">
            <span className={missedCount ? "warn" : ""}>
              {missedCount ? `${missedCount} 个待救援` : "无漏项"}
            </span>
            <span className={overloadedCount ? "warn" : ""}>
              {overloadedCount ? `${overloadedCount} 天过载` : "负载稳"}
            </span>
          </div>
        </div>
        <div className="week-jump" role="group" aria-label="切换周">
          <button
            type="button"
            onClick={() => onSelect(addDaysISO(selectedDate, -7))}
            aria-label="切换到上一周"
          >
            上周
          </button>
          <button
            type="button"
            onClick={() => onSelect(addDaysISO(selectedDate, 7))}
            aria-label="切换到下一周"
          >
            下周
          </button>
        </div>
      </div>
      <nav className="week-strip" aria-label="本周日期">
        {weekDays.map((date) => {
          const isSelected = date === selectedDate;
          const isToday = date === todayKey;
          const dayBlocks = normalizeBlocks(days?.[date]?.blocks || []);
          const stats = getPlanStats(dayBlocks);
          const typeCounts = new Map(dayBlocks.map((block) => [block.type, 0]));
          for (const block of dayBlocks) typeCounts.set(block.type, (typeCounts.get(block.type) || 0) + 1);
          const completion = stats.plannedMinutes
            ? Math.round((stats.doneMinutes / stats.plannedMinutes) * 100)
            : 0;
          const loadRatio = Math.min(1, stats.plannedMinutes / 480);
          const hasPlan = dayBlocks.length > 0;
          const isOverloaded = stats.plannedMinutes > 6 * 60;
          const hasMissed = date < todayKey && dayBlocks.some((block) => block.status === "planned");
          return (
            <button
              key={date}
              type="button"
              className={[
                "week-day",
                isSelected ? "selected" : "",
                isToday ? "today" : "",
                hasPlan ? "has-plan" : "",
                isOverloaded ? "overloaded" : "",
                hasMissed ? "missed" : "",
              ].join(" ")}
              aria-pressed={isSelected}
              aria-label={`${weekdayLabel(date)} ${dayNumber(date)}日${
                hasPlan
                  ? `，${dayBlocks.length}个时间块，计划${stats.plannedMinutes}分钟，完成度${completion}%`
                  : "，暂无安排"
              }`}
              onClick={() => onSelect(date)}
            >
              <span className="week-day-head">
                <span className="week-day-name">{weekdayLabel(date)}</span>
                {isToday && <em>今天</em>}
              </span>
              <span className="week-day-num">{dayNumber(date)}</span>
              <span className="week-load-track" aria-hidden="true">
                <span className="week-load-fill" style={{ width: `${loadRatio * 100}%` }} />
              </span>
              <span className="week-type-dots" aria-hidden="true">
                {TYPE_DOTS.map((type) => (
                  <i key={type} className={typeCounts.get(type) ? type : "empty"} />
                ))}
              </span>
              <span className="week-day-meta" aria-hidden="true">
                {hasMissed
                  ? "待救援"
                  : isOverloaded
                    ? "过载"
                    : hasPlan
                      ? `${dayBlocks.length}块 · ${completion}%`
                      : "空档"}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="week-horizon" aria-label="一周横览">
        {weekHorizon.map((day) => {
          const isSelected = day.date === selectedDate;
          const isToday = day.date === todayKey;
          return (
            <article
              key={day.date}
              className={[
                "week-horizon-day",
                isSelected ? "selected" : "",
                isToday ? "today" : "",
                day.unfinished ? "has-open" : "",
              ].join(" ")}
            >
              <button type="button" onClick={() => onSelect(day.date)} aria-label={`查看 ${day.date} 的规划`}>
                <span>{weekdayLabel(day.date)}</span>
                <strong>{day.date.slice(5)}</strong>
                <small>
                  {day.loadLabel}
                  {day.unfinished ? ` · ${day.unfinished} 待守` : ""}
                </small>
              </button>
              <div className="week-horizon-list">
                {day.blocks.slice(0, 3).map((block) => {
                  const typeClass = block.type && TYPE_DOTS.includes(block.type) ? block.type : "admin";
                  return (
                    <button
                      key={block.id}
                      className={block.status === "done" ? "done" : ""}
                      type="button"
                      onClick={() => onSelect(day.date)}
                      title={`${block.start}-${block.end} ${block.title}`}
                    >
                      <i className={typeClass} aria-hidden="true" />
                      <span>{block.start}</span>
                      <strong>{block.title || "未命名"}</strong>
                    </button>
                  );
                })}
                {day.blocks.length > 3 && <em>+{day.blocks.length - 3} 个</em>}
                {!day.blocks.length && <span className="week-horizon-empty">留给临场</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
