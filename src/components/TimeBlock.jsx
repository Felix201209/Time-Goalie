import { Check, CheckSquare, Copy, GripVertical, SkipForward, Square, Timer, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { compactAccessibleName } from "../accessibility.js";
import { blockTypes } from "../plannerConfig.js";
import { MAX_NOTE_LENGTH, MAX_TITLE_LENGTH } from "../storage.js";
import { durationLabel, isValidTimeRange, safeDomToken } from "../utils.js";

function getPomodoroRemaining(endTime) {
  return Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
}

function PomodoroBadge({ blockTitle, endTime, onExpire }) {
  const [remaining, setRemaining] = useState(() => getPomodoroRemaining(endTime));

  useEffect(() => {
    setRemaining(getPomodoroRemaining(endTime));
    const timer = window.setInterval(() => {
      const nextRemaining = getPomodoroRemaining(endTime);
      setRemaining(nextRemaining);
      if (nextRemaining <= 0) {
        window.clearInterval(timer);
        onExpire(blockTitle);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [blockTitle, endTime, onExpire]);

  return (
    <span className="pomodoro-badge">
      {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
    </span>
  );
}

export function TimeBlock({
  block,
  blockIndex,
  active,
  overlapping,
  overlapDetails,
  selected,
  dimmed,
  dragHandleProps,
  pomodoroEndTime,
  onPatch,
  onStatus,
  onRemove,
  onDuplicate,
  onToggleSelect,
  onTogglePomodoro,
  onPomodoroExpire,
  registerActionRef,
  registerTitleRef,
}) {
  const type = blockTypes[block.type] || blockTypes.deep;
  const nextStatus = block.status === "done" ? "planned" : "done";
  const nextSkipStatus = block.status === "skipped" ? "planned" : "skipped";
  const invalidRange = !isValidTimeRange(block.start, block.end);
  const accessibleTitle = compactAccessibleName(block.title);
  const safeBlockId = `${safeDomToken(block.id, "imported")}-${blockIndex}`;
  const warningId = `block-warning-${safeBlockId}`;
  const fieldName = (field) => `block-${safeBlockId}-${field}`;

  return (
    <article
      data-block-id={safeBlockId}
      data-source-id={block.id}
      className={[
        "time-block",
        type.tone,
        block.status,
        active ? "active" : "",
        overlapping ? "overlap" : "",
        invalidRange ? "invalid" : "",
        dimmed ? "dimmed" : "",
      ].join(" ")}
    >
      <div className="block-time">
        <input
          className="block-time-input"
          aria-label={`${accessibleTitle} 开始时间`}
          name={fieldName("start")}
          autoComplete="off"
          aria-invalid={invalidRange || undefined}
          aria-describedby={invalidRange ? warningId : undefined}
          type="time"
          value={block.start}
          onChange={(event) => onPatch({ start: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onPatch({ start: block.start });
              event.target.blur();
            }
          }}
        />
        <input
          className="block-time-input end"
          aria-label={`${accessibleTitle} 结束时间`}
          name={fieldName("end")}
          autoComplete="off"
          aria-invalid={invalidRange || undefined}
          aria-describedby={invalidRange ? warningId : undefined}
          type="time"
          value={block.end}
          onChange={(event) => onPatch({ end: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onPatch({ end: block.end });
              event.target.blur();
            }
          }}
        />
        {dragHandleProps && (
          <button
            className="block-drag-handle"
            type="button"
            title="拖拽调整时间"
            aria-label={`${accessibleTitle} 拖拽调整时间`}
            {...dragHandleProps}
          >
            <GripVertical size={14} />
          </button>
        )}
      </div>

      <div className="block-body">
        <div className="block-meta">
          <select
            className={`block-type-pill ${type.tone}`}
            aria-label={`${accessibleTitle} 类型`}
            name={fieldName("type")}
            value={block.type}
            onChange={(event) => onPatch({ type: event.target.value })}
          >
            {Object.entries(blockTypes).map(([key, option]) => (
              <option key={key} value={key}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="block-duration">
            {invalidRange ? "检查时间" : durationLabel(block.start, block.end)}
          </span>
          {pomodoroEndTime != null && (
            <PomodoroBadge
              blockTitle={block.title.trim() || "时间块"}
              endTime={pomodoroEndTime}
              onExpire={onPomodoroExpire}
            />
          )}
          {overlapping && <span className="warning">冲突</span>}
          {overlapping && overlapDetails && overlapDetails.length > 0 && (
            <span
              className="warning overlap-detail"
              title={overlapDetails.map((c) => `${c.start}-${c.end} ${c.title}`).join(", ")}
            >
              {overlapDetails.length > 1
                ? `与 ${overlapDetails.length} 个块冲突`
                : `与 ${overlapDetails[0].start} ${compactAccessibleName(overlapDetails[0].title)} 冲突`}
            </span>
          )}
          {invalidRange && (
            <span className="warning" id={warningId}>
              时间无效
            </span>
          )}
        </div>

        <textarea
          ref={(element) => registerTitleRef(block.id, element)}
          className="block-title-input"
          aria-label={`${accessibleTitle} 标题`}
          name={fieldName("title")}
          autoComplete="off"
          maxLength={MAX_TITLE_LENGTH}
          placeholder="未命名时间块…"
          rows={1}
          value={block.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onPatch({ title: block.title });
              event.target.blur();
            }
          }}
          onBlur={(event) => {
            if (!event.target.value.trim()) onPatch({ title: "未命名时间块" });
          }}
        />
        <textarea
          className="block-note-input"
          aria-label={`${accessibleTitle} 备注`}
          name={fieldName("note")}
          autoComplete="off"
          maxLength={MAX_NOTE_LENGTH}
          value={block.note}
          placeholder="备注…"
          rows={1}
          onChange={(event) => onPatch({ note: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onPatch({ note: block.note });
              event.target.blur();
            }
          }}
        />
      </div>

      <div className="block-actions-float">
        {onTogglePomodoro && (
          <button
            type="button"
            title={pomodoroEndTime != null ? "停止番茄钟" : "开始番茄钟"}
            aria-label={`${accessibleTitle} ${pomodoroEndTime != null ? "停止番茄钟" : "开始番茄钟"}`}
            data-action="pomodoro"
            onClick={onTogglePomodoro}
          >
            <Timer size={14} />
          </button>
        )}
        <button
          ref={(element) => registerActionRef(block.id, "done", element)}
          type="button"
          title={block.status === "done" ? "恢复待办" : "完成"}
          aria-label={`${accessibleTitle} ${invalidRange ? "时间无效，无法完成" : block.status === "done" ? "恢复待办" : "完成"}`}
          disabled={invalidRange}
          data-action="done"
          onClick={(event) => onStatus(nextStatus, event.currentTarget)}
        >
          <Check size={14} />
        </button>
        <button
          ref={(element) => registerActionRef(block.id, "skip", element)}
          type="button"
          title={block.status === "skipped" ? "恢复待办" : "跳过"}
          aria-label={`${accessibleTitle} ${invalidRange ? "时间无效，无法跳过" : block.status === "skipped" ? "恢复待办" : "跳过"}`}
          disabled={invalidRange}
          data-action="skip"
          onClick={(event) => onStatus(nextSkipStatus, event.currentTarget)}
        >
          <SkipForward size={14} />
        </button>
        <button
          ref={(element) => registerActionRef(block.id, "duplicate", element)}
          type="button"
          title="复制"
          aria-label={`${accessibleTitle} 复制`}
          data-action="duplicate"
          onClick={onDuplicate}
        >
          <Copy size={14} />
        </button>
        <button
          ref={(element) => registerActionRef(block.id, "delete", element)}
          type="button"
          title="删除"
          aria-label={`${accessibleTitle} 删除`}
          data-action="delete"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
        <button
          ref={(element) => registerActionRef(block.id, "select", element)}
          type="button"
          title={selected ? "取消选择" : "选择"}
          aria-label={`${accessibleTitle} ${selected ? "取消选择" : "选择"}`}
          aria-pressed={selected}
          data-action="select"
          onClick={onToggleSelect}
        >
          {selected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
      </div>
    </article>
  );
}
