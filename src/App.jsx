import {
  BellRing,
  Bot,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  FileText,
  Goal,
  Import,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Wand2,
  X,
} from "lucide-react";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Metric } from "./components/Metric.jsx";
import { SortableTimeBlock } from "./components/SortableTimeBlock.jsx";
import { TimeBlock } from "./components/TimeBlock.jsx";
import { WeekStrip } from "./components/WeekStrip.jsx";
import { getClockLabel, getDateLabel, getSelectedDateLabel } from "./dateLabels.js";
import { focusAfterPaint } from "./focus.js";
import {
  CAPTURE_PRESETS,
  CLOSED_LOOP_TEMPLATES,
  TEMPLATE_PROMPTS,
  createTemplateDraft,
  draftToBlocks,
  parseCaptureIntent,
} from "./closedLoop.js";
import { useAIInbox } from "./hooks/useAIInbox.js";
import { useDebouncedValue } from "./hooks.js";
import { useFirstRunSetup } from "./hooks/useFirstRunSetup.js";
import { usePlanSync } from "./hooks/usePlanSync.js";
import { useReminderSettings } from "./hooks/useReminderSettings.js";
import { createDebouncedSaver } from "./persistence.js";
import { blockTypes, emptyForm, timelineMarks } from "./plannerConfig.js";
import {
  addDaysISO,
  createEmptyDay,
  createSeedDay,
  exportFileName,
  exportPlan,
  getDay,
  importPlan,
  isISODate,
  loadPlan,
  MAX_GOAL_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  revivePlanForToday,
  savePlan,
  todayISO,
} from "./storage.js";
import {
  blockTimelineStyle,
  clampTimelinePercent,
  computeOverlapLayout,
  DAY_END_MINUTES,
  DAY_START_MINUTES,
  findOpenSlot,
  findOverlaps,
  formatMinutes,
  getActiveBlock,
  getNextBlock,
  getOverlapDetails,
  getPlanStats,
  isClockTime,
  isValidTimeRange,
  makeId,
  normalizeBlocks,
  roundUpToStep,
  toMinutes,
  toTime,
} from "./utils.js";
import { applyDateFromURL, getDateFromURL, syncDateToURL } from "./urlDate.js";

function composerFormForSlot(slot, selectedIsToday) {
  if (slot) return { ...emptyForm, ...slot };
  return selectedIsToday ? { ...emptyForm, start: "", end: "" } : emptyForm;
}

function isUntouchedComposerForm(form) {
  const hasCopy = form.title.trim() || form.note.trim();
  const hasDefaultTime = form.start === emptyForm.start && form.end === emptyForm.end;
  const hasNoTime = !form.start && !form.end;
  return !hasCopy && (hasDefaultTime || hasNoTime);
}

function hasTimeCollision(candidate, blocks) {
  if (!isValidTimeRange(candidate.start, candidate.end)) return true;
  const start = toMinutes(candidate.start);
  const end = toMinutes(candidate.end);
  return blocks.some((block) => {
    if (!isValidTimeRange(block.start, block.end)) return false;
    return start < toMinutes(block.end) && toMinutes(block.start) < end;
  });
}

function inferCaptureType(text) {
  if (/读|书|复习|学习|题|考试|写|创作|项目|代码|论文/.test(text)) return "deep";
  if (/发|交|提交|发布|完成|寄|买|缴|付款|账单/.test(text)) return "ship";
  if (/复盘|总结|记录|检查|回顾/.test(text)) return "review";
  return "admin";
}

function getWeekDates(selectedDate) {
  const date = new Date(selectedDate);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(date);
    item.setDate(date.getDate() + mondayOffset + index);
    return todayISO(item);
  });
}

function appendRescueNote(note, label) {
  const suffix = `本周${label}`;
  if (String(note || "").includes(suffix)) return note || "";
  return [note, suffix].filter(Boolean).join(" · ").slice(0, MAX_NOTE_LENGTH);
}

function reminderTimeLabel(fireAt) {
  const date = new Date(fireAt);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function reminderKindLabel(kind) {
  if (kind === "lead") return "提前";
  if (kind === "start") return "开始";
  if (kind === "overdue") return "超时";
  if (kind === "morning-brief") return "早间";
  if (kind === "evening-review") return "晚间";
  if (kind === "carry-over") return "结转";
  return "提醒";
}

function buildWeekReview(plan, weekDates) {
  const dayReviews = weekDates.map((date) => {
    const blocks = normalizeBlocks(getDay(plan, date).blocks);
    const stats = getPlanStats(blocks);
    const unfinished = blocks.filter(
      (block) => block.status !== "done" && isValidTimeRange(block.start, block.end),
    );
    return { date, blocks, stats, unfinished };
  });
  const plannedMinutes = dayReviews.reduce((sum, item) => sum + item.stats.plannedMinutes, 0);
  const doneMinutes = dayReviews.reduce((sum, item) => sum + item.stats.doneMinutes, 0);
  const completion = plannedMinutes ? Math.round((doneMinutes / plannedMinutes) * 100) : 0;
  const unfinishedCount = dayReviews.reduce((sum, item) => sum + item.unfinished.length, 0);
  const overloadedDays = dayReviews.filter((item) => item.stats.plannedMinutes > 6 * 60).length;
  const busiest = dayReviews.reduce((best, item) =>
    item.stats.plannedMinutes > (best?.stats.plannedMinutes || 0) ? item : best,
  );
  const suggestion =
    unfinishedCount > 0
      ? `下周先承接 ${unfinishedCount} 个未完成事项`
      : overloadedDays > 0
        ? "下周先均衡过载日，避免连续硬扛"
        : completion >= 80
          ? "节奏不错，下周可以保留相同结构"
          : "先安排 1 个最重要时间块，别让计划空转";
  return {
    plannedLabel: formatMinutes(plannedMinutes),
    completion,
    unfinishedCount,
    overloadedDays,
    busiestDate: busiest?.date || weekDates[0],
    busiestLabel: busiest?.stats.plannedMinutes
      ? `${busiest.date.slice(5)} · ${formatMinutes(busiest.stats.plannedMinutes)}`
      : "暂无",
    suggestion,
  };
}

function buildGuardLedger(plan, todayKey, now) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dates = Array.from({ length: 7 }, (_, index) => addDaysISO(todayKey, index));
  const entries = dates.flatMap((date) =>
    normalizeBlocks(getDay(plan, date).blocks)
      .filter((block) => block.status !== "done" && isValidTimeRange(block.start, block.end))
      .map((block) => ({
        ...block,
        date,
        isToday: date === todayKey,
        isOverdue: date === todayKey && toMinutes(block.end) < nowMinutes,
      })),
  );
  const upcoming = entries.filter((entry) => !entry.isOverdue);
  const todayCount = entries.filter((entry) => entry.isToday).length;
  const overdueCount = entries.filter((entry) => entry.isOverdue).length;
  const coverage = dates.filter((date) => entries.some((entry) => entry.date === date)).length;
  const totalMinutes = entries.reduce((sum, entry) => sum + toMinutes(entry.end) - toMinutes(entry.start), 0);
  const nextEntry = upcoming[0] || null;

  return {
    entries,
    cards: upcoming.slice(0, 6),
    coverage,
    nextEntry,
    overdueCount,
    todayCount,
    total: entries.length,
    totalLabel: formatMinutes(totalMinutes),
  };
}

function buildDailyCloseout(blocks, selectedDate, todayKey, stats) {
  const actionable = normalizeBlocks(blocks).filter((block) => isValidTimeRange(block.start, block.end));
  const unfinished = actionable.filter((block) => block.status !== "done" && block.status !== "skipped");
  const skipped = actionable.filter((block) => block.status === "skipped").length;
  const label = selectedDate === todayKey ? "今日收口" : "当日收口";
  const suggestion =
    unfinished.length > 0
      ? `承接 ${unfinished.length} 个未完成事项`
      : stats.doneBlocks > 0
        ? "节奏已闭合，给明天留第一块"
        : "先写一个最小时间块，再收口";
  return {
    label,
    unfinishedCount: unfinished.length,
    skipped,
    doneLabel: `${stats.doneBlocks}/${stats.totalBlocks}`,
    suggestion,
    actionLabel: unfinished.length > 0 ? "承接明天" : "明日第一块",
  };
}

function App() {
  const [plan, setPlan] = useState(() => applyDateFromURL(loadPlan()));
  const [form, setForm] = useState(emptyForm);
  const [now, setNow] = useState(() => new Date());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [toast, setToast] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [selectedBlockIds, setSelectedBlockIds] = useState(new Set());
  const [pomodoro, setPomodoro] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [timelineHover, setTimelineHover] = useState(null);
  const [activeDragId, setActiveDragId] = useState(null);
  const [templatePending, setTemplatePending] = useState("");
  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false);
  const [closeoutResult, setCloseoutResult] = useState(null);
  const [captureText, setCaptureText] = useState("");
  const [capturePreset, setCapturePreset] = useState(CAPTURE_PRESETS[0].id);
  const fileInputRef = useRef(null);
  const dailyGoalRef = useRef(null);
  const blockTitleRef = useRef(null);
  const blockStartRef = useRef(null);
  const blockEndRef = useRef(null);
  const fileImportButtonRef = useRef(null);
  const importToggleRef = useRef(null);
  const importTextAreaRef = useRef(null);
  const timelinePanelRef = useRef(null);
  const timelineHoverFrameRef = useRef(0);
  const storageWarningShownRef = useRef(false);
  const saverRef = useRef(null);
  const actionRefs = useRef(new Map());
  const titleRefs = useRef(new Map());
  const autoReviveDateRef = useRef(getDateFromURL() === null);
  const applyImportedPlanRef = useRef(null);
  const [toastPaused, setToastPaused] = useState(false);
  const notify = useCallback((message, options = {}) => setToast({ message, ...options }), []);
  const planSync = usePlanSync(plan, notify);
  const reminderSettings = useReminderSettings(notify);
  const firstRunSetup = useFirstRunSetup(notify);
  const aiInbox = useAIInbox({ plan, selectedDate: plan.selectedDate, onToast: notify });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const currentDay = getDay(plan, plan.selectedDate);
  const blocks = useMemo(() => normalizeBlocks(currentDay.blocks), [currentDay.blocks]);
  const overlaps = useMemo(() => findOverlaps(blocks), [blocks]);
  const overlapDetails = useMemo(() => getOverlapDetails(blocks), [blocks]);
  const overlapLayout = useMemo(() => computeOverlapLayout(blocks), [blocks]);
  const todayKey = todayISO(now);
  const isSelectedToday = plan.selectedDate === todayKey;
  const activeBlock = useMemo(
    () => (isSelectedToday ? getActiveBlock(blocks, now) : null),
    [blocks, now, isSelectedToday],
  );
  const nextBlock = useMemo(() => getNextBlock(blocks, now), [blocks, now]);
  const stats = useMemo(() => getPlanStats(blocks), [blocks]);
  const currentPercent = clampTimelinePercent(now.toTimeString().slice(0, 5));
  const clockLabel = getClockLabel(now);
  const dateLabel = getDateLabel(now);
  const timelineMeta = isSelectedToday ? clockLabel : getSelectedDateLabel(plan.selectedDate);
  const preferredSlotStart = isSelectedToday
    ? roundUpToStep(now.getHours() * 60 + now.getMinutes(), 15)
    : 9 * 60;
  const completion = stats.plannedMinutes ? Math.round((stats.doneMinutes / stats.plannedMinutes) * 100) : 0;
  const weekDates = useMemo(() => getWeekDates(plan.selectedDate), [plan.selectedDate]);
  const weekReview = useMemo(() => buildWeekReview(plan, weekDates), [plan, weekDates]);
  const guardLedger = useMemo(() => buildGuardLedger(plan, todayKey, now), [plan, todayKey, now]);
  const dailyCloseout = useMemo(
    () => buildDailyCloseout(blocks, plan.selectedDate, todayKey, stats),
    [blocks, plan.selectedDate, todayKey, stats],
  );
  const visibleCloseoutResult = closeoutResult?.sourceDate === plan.selectedDate ? closeoutResult : null;
  const visibleTemplates = templatesExpanded
    ? CLOSED_LOOP_TEMPLATES
    : CLOSED_LOOP_TEMPLATES.filter((template) =>
        ["reading", "study", "project", "health", "admin"].includes(template.id),
      );
  const capturePresetItem = useMemo(
    () => CAPTURE_PRESETS.find((item) => item.id === capturePreset) || CAPTURE_PRESETS[0],
    [capturePreset],
  );
  const captureIntent = useMemo(
    () =>
      parseCaptureIntent(captureText, {
        selectedDate: plan.selectedDate,
        todayKey,
        preset: capturePresetItem,
      }),
    [captureText, plan.selectedDate, todayKey, capturePresetItem],
  );

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 140);

  const filteredBlockIds = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return null;
    const q = debouncedSearchQuery.trim().toLowerCase();
    return new Set(
      blocks
        .filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.note.toLowerCase().includes(q) ||
            b.start.includes(q) ||
            b.end.includes(q),
        )
        .map((b) => b.id),
    );
  }, [blocks, debouncedSearchQuery]);

  const downloadPlan = useCallback(() => {
    const blob = new Blob([exportPlan(plan)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName(plan);
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    window.requestAnimationFrame(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    });
    setToast({ message: "规划已导出" });
  }, [plan]);

  const handleSaveFailure = useCallback(() => {
    if (!storageWarningShownRef.current) {
      storageWarningShownRef.current = true;
      setToast({ message: "本地存储不可用，请导出备份", actionLabel: "导出", onAction: downloadPlan });
    }
  }, [downloadPlan]);

  if (!saverRef.current) {
    saverRef.current = createDebouncedSaver(savePlan, 300);
  }

  useEffect(() => {
    saverRef.current.schedule(plan, handleSaveFailure);
  }, [handleSaveFailure, plan]);

  useEffect(() => {
    syncDateToURL(plan.selectedDate);
  }, [plan.selectedDate]);

  useEffect(() => {
    const flush = () => saverRef.current.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      saverRef.current.flush();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => window.cancelAnimationFrame(timelineHoverFrameRef.current), []);

  useEffect(() => {
    if (!autoReviveDateRef.current) return;
    setPlan((current) => (current.selectedDate < todayKey ? revivePlanForToday(current, todayKey) : current));
  }, [todayKey]);

  useLayoutEffect(() => {
    const element = dailyGoalRef.current;
    if (!element) return;
    let animationFrame = 0;
    const fitGoalHeight = () => {
      element.style.height = "auto";
      const maxHeight = window.matchMedia("(max-width: 620px)").matches ? 188 : 260;
      const nextHeight = Math.min(element.scrollHeight, maxHeight);
      element.style.height = `${nextHeight}px`;
      element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    const handleResize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fitGoalHeight);
    };
    fitGoalHeight();
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, [currentDay.goal, plan.selectedDate]);

  useEffect(() => {
    if (!toast) return undefined;
    if (toastPaused) return undefined;
    const duration = toast.actionLabel ? 5200 : 2600;
    const timer = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timer);
  }, [toast, toastPaused]);

  useEffect(() => {
    setToastPaused(false);
  }, [toast?.message, toast?.actionLabel]);

  useEffect(() => {
    if (!importOpen) return;
    focusAfterPaint(importTextAreaRef.current);
  }, [importOpen]);

  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault();
    };
    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const MAX_FILE_SIZE = 2 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        setToast({ message: "拖入文件过大，请拆分后重试（最大 2 MB）" });
        return;
      }
      if (!file.name.toLowerCase().endsWith(".json")) {
        setToast({ message: "请拖入 .json 文件，大小写后缀都支持" });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          applyImportedPlanRef.current(importPlan(String(reader.result)));
        } catch (error) {
          setToast({ message: error.message });
        }
      };
      reader.onerror = () => {
        setToast({ message: "文件读取失败" });
      };
      reader.readAsText(file);
    };
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select";
      if (e.key === "Escape") {
        if (importOpen) {
          e.preventDefault();
          setImportOpen(false);
          focusAfterPaint(importToggleRef.current);
          return;
        }
        if (selectedBlockIds.size > 0) {
          e.preventDefault();
          setSelectedBlockIds(new Set());
          return;
        }
      }
      if (isEditing) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        focusAfterPaint(blockTitleRef.current);
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        shiftSelectedDate(-1);
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        shiftSelectedDate(1);
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        updatePlan({ focusMode: !plan.focusMode });
      }
      if (e.key === "?" && !e.shiftKey) {
        e.preventDefault();
        setToast({
          message: "N 新建 · ↑↓ 导航块 · J/K 切换日期 · F 专注模式 · ? 帮助 · 点击时间轴快速创建",
          actionLabel: "知道了",
          onAction: () => {},
        });
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const currentBlockId = document.activeElement?.closest(".time-block")?.dataset?.sourceId;
        if (!currentBlockId) return;
        const index = blocks.findIndex((block) => block.id === currentBlockId);
        const nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
        const nextBlock = blocks[nextIndex];
        if (nextBlock) {
          e.preventDefault();
          focusAfterPaint(titleRefs.current.get(nextBlock.id));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blocks, importOpen, plan.focusMode, shiftSelectedDate, selectedBlockIds]);

  useEffect(() => {
    setForm((current) => {
      if (!isUntouchedComposerForm(current)) {
        return current;
      }
      const slot = findOpenSlot(blocks, preferredSlotStart, 60, { allowPastFallback: !isSelectedToday });
      return composerFormForSlot(slot, isSelectedToday);
    });
  }, [blocks, preferredSlotStart, isSelectedToday]);

  function updatePlan(patch) {
    setPlan((current) => ({ ...current, ...patch }));
  }

  function selectDate(selectedDate) {
    if (!isISODate(selectedDate)) {
      setToast({ message: "日期格式无效" });
      return;
    }
    const targetPlan = { ...plan, selectedDate };
    const targetBlocks = normalizeBlocks(getDay(targetPlan, selectedDate).blocks);
    const preferred =
      selectedDate === todayKey ? roundUpToStep(now.getHours() * 60 + now.getMinutes(), 15) : 9 * 60;
    const slot = findOpenSlot(targetBlocks, preferred, 60, { allowPastFallback: selectedDate !== todayKey });
    setPlan((current) => ({
      ...current,
      selectedDate,
      days: {
        ...current.days,
        [selectedDate]: current.days?.[selectedDate] || createEmptyDay(),
      },
    }));
    setForm(composerFormForSlot(slot, selectedDate === todayKey));
    setFormErrors({});
    setSelectedBlockIds(new Set());
  }

  function openLedgerItem(entry) {
    selectDate(entry.date);
    setSearchQuery("");
    notify(`已跳到 ${entry.date} ${entry.start}`);
    window.requestAnimationFrame(() =>
      timelinePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function openCloseoutResult() {
    if (!visibleCloseoutResult?.targetDate) return;
    selectDate(visibleCloseoutResult.targetDate);
    window.requestAnimationFrame(() =>
      timelinePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function shiftSelectedDate(offset) {
    selectDate(addDaysISO(plan.selectedDate, offset));
  }

  function updateDay(patch) {
    setPlan((current) => {
      const day = getDay(current);
      return {
        ...current,
        days: {
          ...current.days,
          [current.selectedDate]: { ...day, ...patch },
        },
      };
    });
  }

  function toggleImportPanel() {
    setImportOpen((value) => {
      const nextValue = !value;
      return nextValue;
    });
  }

  function closeImportPanel() {
    setImportOpen(false);
    focusAfterPaint(importToggleRef.current);
  }

  function getTimeFromTimelineY(timeline, clientY) {
    const rect = timeline.getBoundingClientRect();
    const y = clientY - rect.top;
    const percent = Math.max(0, Math.min(1, y / rect.height));
    const range = DAY_END_MINUTES - DAY_START_MINUTES;
    return DAY_START_MINUTES + percent * range;
  }

  function handleTimelineClick(event) {
    const timeline = event.currentTarget;
    if (event.target.closest(".time-block-wrapper") || event.target.closest(".timeline-marks")) {
      return;
    }
    const rawMinutes = getTimeFromTimelineY(timeline, event.clientY);
    const snapped = roundUpToStep(Math.round(rawMinutes), 15);
    const start = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES - 30, snapped));
    const end = Math.min(DAY_END_MINUTES, start + 60);
    setForm({ ...form, start: toTime(start), end: toTime(end) });
    setFormErrors({});
    focusAfterPaint(blockTitleRef.current);
  }

  function handleTimelineMouseMove(event) {
    const timeline = event.currentTarget;
    const clientY = event.clientY;
    window.cancelAnimationFrame(timelineHoverFrameRef.current);
    timelineHoverFrameRef.current = window.requestAnimationFrame(() => {
      const rawMinutes = getTimeFromTimelineY(timeline, clientY);
      const snapped = roundUpToStep(Math.round(rawMinutes), 15);
      setTimelineHover({
        top: `${clampTimelinePercent(toTime(snapped))}%`,
        time: toTime(snapped),
      });
    });
  }

  function handleTimelineMouseLeave() {
    window.cancelAnimationFrame(timelineHoverFrameRef.current);
    setTimelineHover(null);
  }

  function addBlock(event) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormErrors({ title: true });
      setToast({ message: "先给时间块起个名字" });
      focusAfterPaint(blockTitleRef.current);
      return;
    }
    if (!isClockTime(form.start) || !isClockTime(form.end)) {
      setFormErrors({ start: !isClockTime(form.start), end: !isClockTime(form.end) });
      setToast({ message: "请填写有效的开始和结束时间" });
      focusAfterPaint(!isClockTime(form.start) ? blockStartRef.current : blockEndRef.current);
      return;
    }
    if (toMinutes(form.end) <= toMinutes(form.start)) {
      setFormErrors({ end: true });
      setToast({ message: "结束时间要晚于开始时间，跨午夜请拆成两段" });
      focusAfterPaint(blockEndRef.current);
      return;
    }
    if (isSelectedToday && toMinutes(form.start) < now.getHours() * 60 + now.getMinutes()) {
      setFormErrors({ start: true });
      setToast({ message: "开始时间已经过去，请选择接下来的空档" });
      focusAfterPaint(blockStartRef.current);
      return;
    }
    setFormErrors({});

    const newBlock = {
      ...form,
      id: makeId(),
      title,
      note: form.note.trim(),
      status: "planned",
    };

    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [current.selectedDate]: {
          ...getDay(current),
          blocks: [...getDay(current).blocks, newBlock],
        },
      },
    }));
    const nextStart = toMinutes(form.end);
    const nextSlot = findOpenSlot([...blocks, newBlock], nextStart, 60, {
      allowPastFallback: !isSelectedToday,
    });
    const fallbackStart = Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES - 60, nextStart));
    const futureFallback = { start: toTime(fallbackStart), end: toTime(fallbackStart + 60) };
    const nextForm = nextSlot
      ? { ...emptyForm, ...nextSlot }
      : isSelectedToday
        ? { ...emptyForm, start: "", end: "" }
        : { ...emptyForm, ...futureFallback };
    setForm(nextForm);
    setToast({ message: isSelectedToday ? "已加入今天的防线" : "已加入当日防线" });
  }

  function patchBlock(id, patch) {
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [current.selectedDate]: {
          ...getDay(current),
          blocks: getDay(current).blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
        },
      },
    }));
  }

  function registerActionRef(blockId, action, element) {
    const key = `${blockId}:${action}`;
    if (element) {
      actionRefs.current.set(key, element);
      return;
    }
    actionRefs.current.delete(key);
  }

  function registerTitleRef(blockId, element) {
    if (element) {
      titleRefs.current.set(blockId, element);
      return;
    }
    titleRefs.current.delete(blockId);
  }

  function focusActionButton(blockId, action) {
    actionRefs.current.get(`${blockId}:${action}`)?.focus();
  }

  function updateBlockStatus(id, status, restoreFocusTarget) {
    const block = blocks.find((item) => item.id === id);
    if (!block || block.status === status) return;

    const statusDate = plan.selectedDate;
    const previousStatus = block.status;
    const blockTitle = block.title.trim() || "未命名时间块";
    const statusMessage = status === "done" ? "已完成" : status === "skipped" ? "已跳过" : "已恢复待办";

    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [statusDate]: {
          ...getDay(current, statusDate),
          blocks: getDay(current, statusDate).blocks.map((item) =>
            item.id === id ? { ...item, status } : item,
          ),
        },
      },
    }));
    setToast({
      message: `${statusMessage}：${blockTitle}`,
      actionLabel: "撤销",
      onAction: () => {
        setPlan((current) => ({
          ...current,
          days: {
            ...current.days,
            [statusDate]: {
              ...getDay(current, statusDate),
              blocks: getDay(current, statusDate).blocks.map((item) =>
                item.id === id ? { ...item, status: previousStatus } : item,
              ),
            },
          },
        }));
        setToast({ message: "已恢复" });
        focusAfterPaint(restoreFocusTarget);
      },
    });
  }

  function duplicateBlock(id) {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const startMinutes = toMinutes(block.end);
    const duration = Math.max(15, toMinutes(block.end) - toMinutes(block.start));
    const endMinutes = Math.min(DAY_END_MINUTES, startMinutes + duration);
    const newBlock = {
      ...block,
      id: makeId(),
      start: toTime(startMinutes),
      end: toTime(endMinutes),
      status: "planned",
    };
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [current.selectedDate]: {
          ...getDay(current),
          blocks: [...getDay(current).blocks, newBlock],
        },
      },
    }));
    setToast({ message: `已复制：${block.title.trim() || "未命名时间块"}` });
  }

  function toggleBlockSelection(id) {
    setSelectedBlockIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function batchComplete() {
    const targetIds = new Set(selectedBlockIds);
    if (targetIds.size === 0) return;
    const date = plan.selectedDate;
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [date]: {
          ...getDay(current, date),
          blocks: getDay(current, date).blocks.map((block) =>
            targetIds.has(block.id) && block.status !== "done" ? { ...block, status: "done" } : block,
          ),
        },
      },
    }));
    setSelectedBlockIds(new Set());
    setToast({ message: `已完成 ${targetIds.size} 个时间块` });
  }

  function batchSkip() {
    const targetIds = new Set(selectedBlockIds);
    if (targetIds.size === 0) return;
    const date = plan.selectedDate;
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [date]: {
          ...getDay(current, date),
          blocks: getDay(current, date).blocks.map((block) =>
            targetIds.has(block.id) && block.status !== "skipped" ? { ...block, status: "skipped" } : block,
          ),
        },
      },
    }));
    setSelectedBlockIds(new Set());
    setToast({ message: `已跳过 ${targetIds.size} 个时间块` });
  }

  function batchDelete() {
    const targetIds = new Set(selectedBlockIds);
    if (targetIds.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${targetIds.size} 个时间块吗？`)) return;
    const date = plan.selectedDate;
    const removed = getDay(plan, date).blocks.filter((block) => targetIds.has(block.id));
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [date]: {
          ...getDay(current, date),
          blocks: getDay(current, date).blocks.filter((block) => !targetIds.has(block.id)),
        },
      },
    }));
    setSelectedBlockIds(new Set());
    setToast({
      message: `已删除 ${targetIds.size} 个时间块`,
      actionLabel: "撤销",
      onAction: () => {
        setPlan((current) => ({
          ...current,
          days: {
            ...current.days,
            [date]: {
              ...getDay(current, date),
              blocks: [...getDay(current, date).blocks, ...removed],
            },
          },
        }));
        setToast({ message: "已恢复" });
      },
    });
  }

  function togglePomodoro(block) {
    if (pomodoro?.blockId === block.id) {
      setPomodoro(null);
      return;
    }
    const duration = 25 * 60 * 1000;
    setPomodoro({
      blockId: block.id,
      blockTitle: block.title.trim() || "时间块",
      endTime: Date.now() + duration,
      duration,
    });
  }

  function expirePomodoro(blockTitle) {
    setPomodoro(null);
    setToast({ message: `番茄钟结束：${blockTitle || "时间块"}` });
  }

  function copyMarkdown() {
    const day = currentDay;
    const lines = [
      `# ${plan.selectedDate} 规划`,
      "",
      `**目标：** ${day.goal}`,
      "",
      "## 时间块",
      ...normalizeBlocks(day.blocks).map(
        (b) =>
          `- [${b.status === "done" ? "x" : " "}] ${b.start}-${b.end} **${b.title || "未命名时间块"}** (${blockTypes[b.type]?.label || "深度"})${b.note ? ` — ${b.note}` : ""}`,
      ),
      "",
      `> 生成于 ${new Date().toLocaleString("zh-CN")}`,
    ];
    const text = lines.join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => setToast({ message: "Markdown 已复制到剪贴板" }));
    } else {
      setToast({ message: "浏览器不支持复制，请手动导出" });
    }
  }

  function handleDragStart(event) {
    setActiveDragId(event.active.id);
  }

  function handleDragEnd(event) {
    setActiveDragId(null);
    const { active, delta } = event;
    if (!delta || (Math.abs(delta.x) < 2 && Math.abs(delta.y) < 2)) return;
    const dragged = blocks.find((b) => b.id === active.id);
    if (!dragged) return;
    const minutesDelta = Math.round((delta.y / 1200) * (DAY_END_MINUTES - DAY_START_MINUTES));
    const snappedDelta = Math.round(minutesDelta / 15) * 15;
    if (snappedDelta === 0) return;
    const newStart = toMinutes(dragged.start) + snappedDelta;
    const newEnd = toMinutes(dragged.end) + snappedDelta;
    if (newStart >= DAY_START_MINUTES && newEnd <= DAY_END_MINUTES) {
      patchBlock(active.id, { start: toTime(newStart), end: toTime(newEnd) });
    }
  }

  function removeBlock(id) {
    const removedDate = plan.selectedDate;
    const storedBlocks = getDay(plan, removedDate).blocks;
    const removed = storedBlocks.find((block) => block.id === id);
    const removedIndex = storedBlocks.findIndex((block) => block.id === id);
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [removedDate]: {
          ...getDay(current, removedDate),
          blocks: getDay(current, removedDate).blocks.filter((block) => block.id !== id),
        },
      },
    }));
    if (removed) {
      setToast({
        message: "已删除时间块",
        actionLabel: "撤销",
        onAction: () => {
          const insertIndex = Math.max(0, removedIndex);
          setPlan((current) => ({
            ...current,
            days: {
              ...current.days,
              [removedDate]: {
                ...getDay(current, removedDate),
                blocks: [
                  ...getDay(current, removedDate).blocks.slice(0, insertIndex),
                  removed,
                  ...getDay(current, removedDate).blocks.slice(insertIndex),
                ],
              },
            },
          }));
          setToast({ message: "已恢复" });
          focusAfterPaint(() => focusActionButton(id, "delete"));
        },
      });
    }
  }

  function resetDay() {
    const confirmMessage = isSelectedToday
      ? "确定要重置今日规划吗？当前的目标和时间块都会被替换为默认规划。"
      : "确定要清空当日规划吗？此操作无法撤销。";
    if (!window.confirm(confirmMessage)) return;
    const resetDate = plan.selectedDate;
    const previousDay = getDay(plan, resetDate);
    const previousForm = form;
    const nextDay = isSelectedToday ? createSeedDay() : createEmptyDay();
    const nextSlot = findOpenSlot(normalizeBlocks(nextDay.blocks), preferredSlotStart, 60, {
      allowPastFallback: !isSelectedToday,
    });
    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [resetDate]: nextDay,
      },
    }));
    setForm(composerFormForSlot(nextSlot, isSelectedToday));
    setFormErrors({});
    setToast({
      message: isSelectedToday ? "已恢复今日默认规划" : "已清空当日规划",
      actionLabel: "撤销",
      onAction: () => {
        setPlan((current) => ({
          ...current,
          days: {
            ...current.days,
            [resetDate]: previousDay,
          },
        }));
        setForm(previousForm);
        setToast({ message: "已恢复当日规划" });
      },
    });
  }

  function applyImportedPlan(nextPlan, options = {}) {
    const targetBlocks = normalizeBlocks(getDay(nextPlan, nextPlan.selectedDate).blocks);
    const preferred =
      nextPlan.selectedDate === todayKey ? roundUpToStep(now.getHours() * 60 + now.getMinutes(), 15) : 9 * 60;
    const slot = findOpenSlot(targetBlocks, preferred, 60, {
      allowPastFallback: nextPlan.selectedDate !== todayKey,
    });
    setPlan(nextPlan);
    setForm(composerFormForSlot(slot, nextPlan.selectedDate === todayKey));
    setFormErrors({});
    setImportText("");
    setImportOpen(false);
    if (options.restoreFileFocus) {
      focusAfterPaint(fileImportButtonRef.current);
    }
    if (options.restorePasteFocus) {
      focusAfterPaint(importToggleRef.current);
    }
    setToast({ message: "导入成功" });
  }

  applyImportedPlanRef.current = applyImportedPlan;

  function handleFileImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const MAX_FILE_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setToast({ message: "导入文件过大，请拆分后重试（最大 2 MB）" });
      event.target.value = "";
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      setToast({ message: "请选择 .json 文件，大小写后缀都支持" });
      focusAfterPaint(fileImportButtonRef.current);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyImportedPlan(importPlan(String(reader.result)), { restoreFileFocus: true });
      } catch (error) {
        setToast({ message: error.message });
        focusAfterPaint(fileImportButtonRef.current);
      }
    };
    reader.onerror = () => {
      setToast({ message: "文件读取失败，请重新选择 JSON 文件" });
      focusAfterPaint(fileImportButtonRef.current);
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function submitTextImport() {
    if (!importText.trim()) {
      setToast({ message: "请先粘贴 Time Goalie JSON" });
      focusAfterPaint(importTextAreaRef.current);
      return;
    }
    const MAX_TEXT_LENGTH = 500_000;
    if (importText.length > MAX_TEXT_LENGTH) {
      setToast({ message: "粘贴内容过长，请拆分后重试" });
      focusAfterPaint(importTextAreaRef.current);
      return;
    }
    try {
      applyImportedPlan(importPlan(importText), { restorePasteFocus: true });
    } catch (error) {
      setToast({ message: error.message });
      focusAfterPaint(importTextAreaRef.current);
    }
  }

  function scheduleDraftBlocks(draft, existingBlocks) {
    const draftBlocks = draftToBlocks(draft, makeId);
    const occupied = normalizeBlocks(existingBlocks);
    let cursor = preferredSlotStart;

    return draftBlocks.map((block) => {
      const duration = isValidTimeRange(block.start, block.end)
        ? Math.max(30, toMinutes(block.end) - toMinutes(block.start))
        : 45;
      const preferred = isClockTime(block.start) ? toMinutes(block.start) : cursor;
      let nextBlock = {
        ...block,
        title: block.title.slice(0, MAX_TITLE_LENGTH),
        note: block.note.slice(0, MAX_NOTE_LENGTH),
      };

      if (hasTimeCollision(nextBlock, occupied)) {
        const slot = findOpenSlot(occupied, preferred, duration, { allowPastFallback: true });
        if (slot) nextBlock = { ...nextBlock, ...slot };
      }

      if (isValidTimeRange(nextBlock.start, nextBlock.end)) {
        cursor = toMinutes(nextBlock.end);
      }
      occupied.push(nextBlock);
      return nextBlock;
    });
  }

  function applyAIDraft() {
    const draft = aiInbox.draft;
    if (!draft) {
      notify("先生成一个 AI 草稿");
      return;
    }
    const targetDate = plan.selectedDate;
    const existingBlocks = getDay(plan, targetDate).blocks;
    const nextBlocks = scheduleDraftBlocks(draft, existingBlocks);
    if (nextBlocks.length === 0 && !draft.goal) {
      notify("草稿里没有可写入的时间块");
      return;
    }
    setPlan((current) => {
      const day = getDay(current, targetDate);
      return {
        ...current,
        selectedDate: targetDate,
        days: {
          ...current.days,
          [targetDate]: {
            ...day,
            goal: draft.goal || day.goal,
            blocks: [...day.blocks, ...nextBlocks],
          },
        },
      };
    });
    aiInbox.setDraft(null);
    aiInbox.setText("");
    setSelectedBlockIds(new Set());
    notify(`已写入 ${nextBlocks.length} 个时间块`);
  }

  async function parseTemplate(key) {
    const templateDraft = createTemplateDraft(key, plan.selectedDate);
    if (templateDraft) {
      aiInbox.setText(TEMPLATE_PROMPTS[key] || templateDraft.goal);
      aiInbox.setDraft(templateDraft);
      notify(`${CLOSED_LOOP_TEMPLATES.find((template) => template.id === key)?.label || "场景"}闭环已生成`);
      return;
    }
    const prompt = TEMPLATE_PROMPTS[key];
    if (!prompt) return;
    setTemplatePending(key);
    aiInbox.setText(prompt);
    await aiInbox.parseText(prompt);
    setTemplatePending("");
  }

  async function testBarkAndRefresh() {
    await reminderSettings.sendTest("bark");
    try {
      await planSync.refreshStatus();
    } catch {
      notify("Bark 测试已完成，但回执刷新需要后端在线");
    }
  }

  function addCaptureItem(event) {
    event?.preventDefault();
    const title = captureText.trim();
    if (!title) {
      notify("先写下要记录或提醒的事");
      return;
    }
    const preset = capturePresetItem;
    const intent = parseCaptureIntent(title, {
      selectedDate: plan.selectedDate,
      todayKey,
      preset,
    });
    const targetDate = intent.targetDate;
    const targetDay = getDay(plan, targetDate);
    const duration = intent.duration;
    const selectedNowMinutes = now.getHours() * 60 + now.getMinutes();
    const preferred =
      intent.explicitTime ??
      (preset.mode === "offset" && targetDate === todayKey
        ? roundUpToStep(selectedNowMinutes + preset.offset, 15)
        : preset.mode === "time" || preset.mode === "tomorrow"
          ? toMinutes(preset.time)
          : preferredSlotStart);
    const slot = findOpenSlot(normalizeBlocks(targetDay.blocks), preferred, duration, {
      allowPastFallback: targetDate !== todayKey,
    });
    if (!slot) {
      notify("今天剩余空档不够，换个提醒时间或拆小一点");
      return;
    }
    const block = {
      id: makeId(),
      title: title.slice(0, MAX_TITLE_LENGTH),
      note: intent.note,
      start: slot.start,
      end: slot.end,
      type: inferCaptureType(title),
      status: "planned",
    };
    setPlan((current) => {
      const day = getDay(current, targetDate);
      return {
        ...current,
        days: {
          ...current.days,
          [targetDate]: {
            ...day,
            goal: day.goal || "把想到的事都接住，到点提醒，从不忘记",
            blocks: [...day.blocks, block],
          },
        },
      };
    });
    setCaptureText("");
    notify(`已记录到 ${targetDate === plan.selectedDate ? "当前日" : targetDate} ${block.start}`);
  }

  function rescueMissedBlocks() {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const missedBlocks = blocks.filter(
      (block) =>
        block.status === "planned" &&
        isValidTimeRange(block.start, block.end) &&
        toMinutes(block.end) < nowMinutes,
    );
    if (!isSelectedToday || missedBlocks.length === 0) {
      notify("当前没有需要救援的错过任务");
      return;
    }

    const targetIds = new Set(missedBlocks.map((block) => block.id));
    const occupied = blocks.filter((block) => !targetIds.has(block.id));
    const updates = new Map();
    let cursor = roundUpToStep(nowMinutes, 15);

    for (const block of missedBlocks) {
      const duration = Math.max(30, toMinutes(block.end) - toMinutes(block.start));
      const slot = findOpenSlot(occupied, cursor, duration, { allowPastFallback: false });
      if (!slot) continue;
      const updated = { ...block, ...slot };
      occupied.push(updated);
      updates.set(block.id, slot);
      cursor = toMinutes(slot.end);
    }

    if (updates.size === 0) {
      notify("今天剩余空档不够，建议手动拆小");
      return;
    }

    setPlan((current) => ({
      ...current,
      days: {
        ...current.days,
        [current.selectedDate]: {
          ...getDay(current),
          blocks: getDay(current).blocks.map((block) =>
            updates.has(block.id) ? { ...block, ...updates.get(block.id) } : block,
          ),
        },
      },
    }));
    notify(`已重排 ${updates.size} 个错过任务`);
  }

  function carryOverTomorrow() {
    const unfinished = blocks.filter(
      (block) =>
        block.status !== "done" && block.status !== "skipped" && isValidTimeRange(block.start, block.end),
    );
    const targetDate = addDaysISO(plan.selectedDate, 1);
    if (unfinished.length === 0) {
      setCloseoutResult(null);
      selectDate(targetDate);
      window.requestAnimationFrame(() => {
        blockTitleRef.current?.focus();
        blockTitleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      notify("已切到明天，写下第一块");
      return;
    }
    setPlan((current) => {
      const targetDay = getDay(current, targetDate);
      const carried = unfinished.map((block, index) => ({
        ...block,
        id: makeId(),
        status: "planned",
        start: toTime(9 * 60 + index * 60),
        end: toTime(9 * 60 + index * 60 + Math.max(30, toMinutes(block.end) - toMinutes(block.start))),
      }));
      return {
        ...current,
        days: {
          ...current.days,
          [targetDate]: {
            ...targetDay,
            goal: targetDay.goal || `承接 ${plan.selectedDate} 未完成事项`,
            blocks: [...targetDay.blocks, ...carried],
          },
        },
      };
    });
    setCloseoutResult({ sourceDate: plan.selectedDate, targetDate, count: unfinished.length });
    notify(`已把 ${unfinished.length} 个未完成任务带到明天`);
  }

  function rescueWeekBlocks() {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetDates = weekDates.filter((date) => date >= todayKey);
    const missed = [];

    for (const date of weekDates) {
      const day = getDay(plan, date);
      for (const block of day.blocks) {
        const isMissed =
          block.status === "planned" &&
          isValidTimeRange(block.start, block.end) &&
          (date < todayKey || (date === todayKey && toMinutes(block.end) < nowMinutes));
        if (isMissed) missed.push({ date, block });
      }
    }

    if (missed.length === 0) {
      notify("本周没有需要救援的错过任务");
      return;
    }

    setPlan((current) => {
      const nextDays = { ...current.days };
      for (const date of weekDates) {
        const day = getDay(current, date);
        nextDays[date] = {
          ...day,
          blocks: day.blocks.filter(
            (block) => !missed.some((item) => item.date === date && item.block.id === block.id),
          ),
        };
      }

      let moved = 0;
      for (const item of missed) {
        const duration = Math.max(30, toMinutes(item.block.end) - toMinutes(item.block.start));
        let placed = false;
        for (const targetDate of targetDates) {
          const targetDay = nextDays[targetDate] || getDay(current, targetDate);
          const preferred =
            targetDate === todayKey
              ? roundUpToStep(nowMinutes, 15)
              : Math.max(9 * 60, toMinutes(item.block.start));
          const slot = findOpenSlot(targetDay.blocks, preferred, duration, {
            allowPastFallback: targetDate !== todayKey,
          });
          if (!slot) continue;
          nextDays[targetDate] = {
            ...targetDay,
            goal: targetDay.goal || `本周救援：承接 ${item.date} 错过事项`,
            blocks: [
              ...targetDay.blocks,
              {
                ...item.block,
                ...slot,
                note: appendRescueNote(item.block.note, `救援自 ${item.date}`),
              },
            ],
          };
          moved += 1;
          placed = true;
          break;
        }

        if (!placed) {
          const sourceDay = nextDays[item.date] || getDay(current, item.date);
          nextDays[item.date] = { ...sourceDay, blocks: [...sourceDay.blocks, item.block] };
        }
      }

      window.requestAnimationFrame(() =>
        notify(moved ? `本周救援已重排 ${moved} 个任务` : "本周剩余空档不够"),
      );
      return { ...current, days: nextDays };
    });
  }

  function balanceWeekLoad() {
    const LOAD_LIMIT = 6 * 60;
    const TARGET_LIMIT = 5 * 60;
    const weekStats = new Map(
      weekDates.map((date) => [
        date,
        getPlanStats(normalizeBlocks(getDay(plan, date).blocks)).plannedMinutes,
      ]),
    );
    const overloaded = weekDates.filter((date) => (weekStats.get(date) || 0) > LOAD_LIMIT);
    if (overloaded.length === 0) {
      notify("本周负载已经比较均衡");
      return;
    }

    setPlan((current) => {
      const nextDays = Object.fromEntries(weekDates.map((date) => [date, { ...getDay(current, date) }]));
      for (const date of weekDates) nextDays[date].blocks = [...nextDays[date].blocks];
      const minutesByDate = new Map(
        weekDates.map((date) => [date, getPlanStats(normalizeBlocks(nextDays[date].blocks)).plannedMinutes]),
      );
      let moved = 0;

      for (const sourceDate of overloaded) {
        const movable = normalizeBlocks(nextDays[sourceDate].blocks)
          .filter((block) => block.status === "planned" && isValidTimeRange(block.start, block.end))
          .reverse();
        for (const block of movable) {
          if ((minutesByDate.get(sourceDate) || 0) <= LOAD_LIMIT) break;
          const duration = Math.max(30, toMinutes(block.end) - toMinutes(block.start));
          const candidates = weekDates.filter(
            (date) =>
              date > sourceDate &&
              date >= todayKey &&
              (minutesByDate.get(date) || 0) + duration <= TARGET_LIMIT,
          );
          for (const targetDate of candidates) {
            const slot = findOpenSlot(
              nextDays[targetDate].blocks,
              Math.max(9 * 60, toMinutes(block.start)),
              duration,
              {
                allowPastFallback: targetDate !== todayKey,
              },
            );
            if (!slot) continue;
            nextDays[sourceDate].blocks = nextDays[sourceDate].blocks.filter((item) => item.id !== block.id);
            nextDays[targetDate] = {
              ...nextDays[targetDate],
              goal: nextDays[targetDate].goal || `本周均衡：承接 ${sourceDate} 过载任务`,
              blocks: [
                ...nextDays[targetDate].blocks,
                {
                  ...block,
                  ...slot,
                  note: appendRescueNote(block.note, `均衡自 ${sourceDate}`),
                },
              ],
            };
            minutesByDate.set(sourceDate, (minutesByDate.get(sourceDate) || 0) - duration);
            minutesByDate.set(targetDate, (minutesByDate.get(targetDate) || 0) + duration);
            moved += 1;
            break;
          }
        }
      }

      window.requestAnimationFrame(() =>
        notify(moved ? `已均衡 ${moved} 个本周任务` : "没有找到合适的后续空档"),
      );
      return { ...current, days: { ...current.days, ...nextDays } };
    });
  }

  function carryOverWeek() {
    const unfinished = [];
    for (const date of weekDates) {
      for (const block of normalizeBlocks(getDay(plan, date).blocks)) {
        if (block.status !== "done" && isValidTimeRange(block.start, block.end)) {
          unfinished.push({ date, block });
        }
      }
    }

    if (unfinished.length === 0) {
      notify("本周没有需要承接的未完成事项");
      return;
    }

    const nextWeekDates = weekDates.map((date) => addDaysISO(date, 7));
    setPlan((current) => {
      const nextDays = { ...current.days };
      for (const date of nextWeekDates) {
        const day = getDay(current, date);
        nextDays[date] = { ...day, blocks: [...day.blocks] };
      }

      let moved = 0;
      for (const item of unfinished) {
        const duration = Math.max(30, toMinutes(item.block.end) - toMinutes(item.block.start));
        let placed = false;
        for (const targetDate of nextWeekDates) {
          const targetDay = nextDays[targetDate];
          const preferred = Math.max(9 * 60, toMinutes(item.block.start));
          const slot = findOpenSlot(targetDay.blocks, preferred, duration, { allowPastFallback: true });
          if (!slot) continue;
          nextDays[targetDate] = {
            ...targetDay,
            goal: targetDay.goal || `承接 ${weekDates[0]} 周未完成事项`,
            blocks: [
              ...targetDay.blocks,
              {
                ...item.block,
                id: makeId(),
                ...slot,
                status: "planned",
                note: appendRescueNote(item.block.note, `承接自 ${item.date}`),
              },
            ],
          };
          moved += 1;
          placed = true;
          break;
        }
        if (!placed) break;
      }

      window.requestAnimationFrame(() =>
        notify(moved ? `已承接 ${moved} 个事项到下周` : "下周没有足够空档，建议先拆小任务"),
      );
      return { ...current, selectedDate: nextWeekDates[0], days: nextDays };
    });
  }

  const firstValidBlock = blocks.find((block) => isValidTimeRange(block.start, block.end));
  const statusCopy = overlaps.size
    ? "有时间冲突"
    : isSelectedToday && activeBlock
      ? `正在守：${activeBlock.title}`
      : isSelectedToday && nextBlock
        ? `下个：${nextBlock.start} ${nextBlock.title}`
        : !isSelectedToday && plan.selectedDate < todayKey
          ? "这是过去的规划"
          : !isSelectedToday && firstValidBlock
            ? `当日首个：${firstValidBlock.start} ${firstValidBlock.title}`
            : "防线清晰";

  function useSuggestedSlot() {
    const requestedDuration = isValidTimeRange(form.start, form.end)
      ? Math.max(30, toMinutes(form.end) - toMinutes(form.start))
      : 60;
    const slot = findOpenSlot(blocks, preferredSlotStart, requestedDuration, {
      allowPastFallback: !isSelectedToday,
    });
    if (!slot) {
      setToast({ message: isSelectedToday ? "今天没有足够空档" : "当日没有足够空档" });
      return;
    }
    setForm((current) => ({ ...current, ...slot }));
    setFormErrors({});
    setToast({ message: `已跳到 ${slot.start}` });
  }

  const missedCount = blocks.filter(
    (block) =>
      isSelectedToday &&
      block.status === "planned" &&
      isValidTimeRange(block.start, block.end) &&
      toMinutes(block.end) < now.getHours() * 60 + now.getMinutes(),
  ).length;
  const weekMissedCount = weekDates.reduce((count, date) => {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return (
      count +
      getDay(plan, date).blocks.filter(
        (block) =>
          block.status === "planned" &&
          isValidTimeRange(block.start, block.end) &&
          (date < todayKey || (date === todayKey && toMinutes(block.end) < nowMinutes)),
      ).length
    );
  }, 0);
  const overloadedWeekDays = weekDates.filter(
    (date) => getPlanStats(normalizeBlocks(getDay(plan, date).blocks)).plannedMinutes > 6 * 60,
  ).length;
  const weekUnfinishedCount = weekDates.reduce(
    (count, date) =>
      count +
      getDay(plan, date).blocks.filter(
        (block) => block.status !== "done" && isValidTimeRange(block.start, block.end),
      ).length,
    0,
  );

  return (
    <main className={plan.focusMode ? "app focus-mode" : "app"}>
      <a className="skip-link" href="#planner-workspace">
        跳到规划区
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Goal size={18} />
          </span>
          <div>
            <strong>Time Goalie</strong>
            <span>守住时间，也守住目标</span>
          </div>
        </div>

        <div className="live-clock" aria-label="当前日期时间">
          <span>{dateLabel}</span>
          <strong>{clockLabel}</strong>
        </div>

        <div className="top-actions">
          <div className="search-wrap">
            <input
              className="search-input"
              type="search"
              placeholder="搜索时间块…"
              aria-label="搜索时间块"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery && (
              <button
                className="search-clear"
                type="button"
                aria-label="清除搜索"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={plan.focusMode ? "切换到日间模式" : "切换到专注模式"}
            aria-pressed={plan.focusMode}
            onClick={() => updatePlan({ focusMode: !plan.focusMode })}
          >
            {plan.focusMode ? <Sun size={17} /> : <Moon size={17} />}
            <span>{plan.focusMode ? "日间" : "专注"}</span>
          </button>
          <button className="icon-button" type="button" aria-label="导出当前规划 JSON" onClick={downloadPlan}>
            <Download size={17} />
            <span>导出</span>
          </button>
          <button className="icon-button" type="button" aria-label="复制当日 Markdown" onClick={copyMarkdown}>
            <FileText size={17} />
            <span>文本</span>
          </button>
          <button
            ref={fileImportButtonRef}
            className="primary-button"
            type="button"
            aria-label="从 JSON 文件导入规划"
            onClick={() => fileInputRef.current?.click()}
          >
            <Import size={17} />
            <span>导入</span>
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="application/json"
            aria-label="选择 Time Goalie JSON 文件"
            onChange={handleFileImport}
          />
        </div>
      </header>

      <WeekStrip
        selectedDate={plan.selectedDate}
        days={plan.days}
        onSelect={selectDate}
        todayKey={todayKey}
        missedCount={weekMissedCount}
        overloadedCount={overloadedWeekDays}
      />

      <section className="week-review" aria-label="一周复盘摘要">
        <div className="week-review-copy">
          <span>一周复盘</span>
          <strong>{weekReview.suggestion}</strong>
        </div>
        <div className="week-review-metrics" aria-label="本周关键指标">
          <span>
            <small>规划</small>
            <strong>{weekReview.plannedLabel}</strong>
          </span>
          <span>
            <small>完成</small>
            <strong>{weekReview.completion}%</strong>
          </span>
          <span className={weekReview.unfinishedCount ? "warn" : ""}>
            <small>未完成</small>
            <strong>{weekReview.unfinishedCount}</strong>
          </span>
          <span className={weekReview.overloadedDays ? "warn" : ""}>
            <small>峰值日</small>
            <strong>{weekReview.busiestLabel}</strong>
          </span>
        </div>
        <div className="guard-ticker" aria-label="接下来三件守门事项">
          <span>接下来</span>
          {guardLedger.cards.length ? (
            <>
              {guardLedger.cards.slice(0, 3).map((entry) => (
                <button key={`${entry.date}-${entry.id}`} type="button" onClick={() => openLedgerItem(entry)}>
                  {entry.isToday ? "今天" : entry.date.slice(5)} {entry.start} {entry.title}
                </button>
              ))}
              {guardLedger.cards.length > 3 && <em>+{guardLedger.cards.length - 3}</em>}
            </>
          ) : (
            <strong>未来 7 天暂无待守事项</strong>
          )}
        </div>
      </section>

      <section className="command-center" aria-label="闭环工作台">
        <div className="command-panel ai-panel">
          <div className="section-title command-title">
            <Bot size={17} />
            <h2>AI 收件箱</h2>
            <span>{aiInbox.draft ? "待确认" : "快速排期"}</span>
          </div>
          <textarea
            className="ai-input"
            aria-label="AI 收件箱输入"
            name="ai-inbox"
            autoComplete="off"
            maxLength={12000}
            placeholder="把任务、笔记、Markdown 或一段乱想法直接放进来…"
            value={aiInbox.text}
            onChange={(event) => aiInbox.setText(event.target.value)}
            rows={5}
          />
          <form className="capture-bar" aria-label="万能记录提醒" onSubmit={addCaptureItem}>
            <div className="capture-copy">
              <strong>万能记录</strong>
              <span>想到什么就接住，保存后自动进入提醒队列</span>
            </div>
            <input
              type="text"
              value={captureText}
              onChange={(event) => setCaptureText(event.target.value)}
              placeholder="例：周五下午3点读书45分钟 / 明早带作业 / 20:00 给老师发邮件"
              aria-label="记录一件要提醒的事"
              maxLength={MAX_TITLE_LENGTH}
            />
            <select
              value={capturePreset}
              onChange={(event) => setCapturePreset(event.target.value)}
              aria-label="提醒时间"
            >
              {CAPTURE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <span className="capture-preview" aria-live="polite">
              {captureIntent.targetDate === plan.selectedDate ? "当前日" : captureIntent.targetDate} ·{" "}
              {captureIntent.explicitTime == null
                ? capturePresetItem.label
                : toTime(captureIntent.explicitTime)}{" "}
              · {formatMinutes(captureIntent.duration)}
            </span>
            <button className="primary-button" type="submit">
              <BellRing size={17} />
              <span>记录</span>
            </button>
          </form>
          <div className="template-row scene-row" aria-label="闭环场景模板">
            {visibleTemplates.map((template) => (
              <button
                key={template.id}
                className="template-chip"
                type="button"
                disabled={aiInbox.isParsing}
                title={template.summary}
                onClick={() => parseTemplate(template.id)}
              >
                <strong>{templatePending === template.id ? "…" : template.label}</strong>
                <span>{template.summary}</span>
              </button>
            ))}
            <button
              className="template-chip more-chip"
              type="button"
              aria-expanded={templatesExpanded}
              onClick={() => setTemplatesExpanded((expanded) => !expanded)}
            >
              <strong>{templatesExpanded ? "收起" : "更多"}</strong>
              <span>
                {templatesExpanded
                  ? "保持轻量"
                  : `还有 ${CLOSED_LOOP_TEMPLATES.length - visibleTemplates.length} 个`}
              </span>
            </button>
          </div>
          <div className="command-actions">
            <button
              className="primary-button"
              type="button"
              disabled={aiInbox.isParsing}
              onClick={() => aiInbox.parseText()}
            >
              <Wand2 size={17} />
              <span>{aiInbox.isParsing ? "生成中" : "生成草稿"}</span>
            </button>
            <button
              className={missedCount ? "ghost-button hot-action" : "ghost-button dimmed-action"}
              type="button"
              onClick={rescueMissedBlocks}
            >
              <RefreshCw size={16} />
              <span>救援 {missedCount || ""}</span>
            </button>
            <button
              className={weekMissedCount ? "ghost-button hot-action" : "ghost-button dimmed-action"}
              type="button"
              onClick={rescueWeekBlocks}
            >
              <RefreshCw size={16} />
              <span>本周救援 {weekMissedCount || ""}</span>
            </button>
            <button
              className={overloadedWeekDays ? "ghost-button hot-action" : "ghost-button dimmed-action"}
              type="button"
              onClick={balanceWeekLoad}
            >
              <ShieldCheck size={16} />
              <span>均衡周 {overloadedWeekDays || ""}</span>
            </button>
            <button className="ghost-button" type="button" onClick={carryOverTomorrow}>
              <CalendarPlus size={16} />
              <span>明日</span>
            </button>
            <button
              className={weekUnfinishedCount ? "ghost-button hot-action" : "ghost-button dimmed-action"}
              type="button"
              onClick={carryOverWeek}
            >
              <CalendarPlus size={16} />
              <span>下周承接 {weekUnfinishedCount || ""}</span>
            </button>
          </div>
          <div className="setup-strip" aria-label="后台状态">
            <span className={planSync.status.online ? "status-pill online" : "status-pill"}>
              {planSync.summary}
            </span>
            <span className="status-pill">{firstRunSetup.summary}</span>
            <span
              className={[
                "status-pill",
                planSync.status.bark?.configured ? "online" : "",
                planSync.status.pending > 0 && planSync.status.bark?.enabled ? "pulsing" : "",
              ].join(" ")}
              title={planSync.status.bark?.last?.message || "Bark 手机提醒状态"}
            >
              {planSync.barkSummary}
            </span>
            <button
              className={reminderPanelOpen ? "ghost-button active" : "ghost-button"}
              type="button"
              aria-expanded={reminderPanelOpen}
              aria-controls={reminderPanelOpen ? "reminder-queue-panel" : undefined}
              onClick={() => setReminderPanelOpen((open) => !open)}
            >
              <BellRing size={16} />
              <span>提醒队列</span>
            </button>
            <button className="ghost-button" type="button" onClick={() => firstRunSetup.setOpen(true)}>
              <Settings2 size={16} />
              <span>配置</span>
            </button>
            <button className="ghost-button" type="button" onClick={planSync.downloadIcs}>
              <CalendarPlus size={16} />
              <span>ICS</span>
            </button>
          </div>
          {reminderPanelOpen && (
            <div className="reminder-panel" id="reminder-queue-panel" aria-label="提醒队列详情">
              <div className="reminder-panel-head">
                <div>
                  <strong>{planSync.status.online ? "提醒守门中" : "后端未连接"}</strong>
                  <span>{planSync.nextReminderLabel}</span>
                  {planSync.status.stalePending > 0 && (
                    <small>{planSync.status.stalePending} 条过期待发已从当前队列隐藏</small>
                  )}
                </div>
                <button className="ghost-button" type="button" onClick={testBarkAndRefresh}>
                  <BellRing size={15} />
                  <span>测试 Bark</span>
                </button>
              </div>
              <div className="reminder-snooze-row" aria-label="提醒延后操作">
                <button
                  className={
                    planSync.status.nextReminder ? "ghost-button hot-action" : "ghost-button dimmed-action"
                  }
                  type="button"
                  onClick={() => planSync.snoozeNext(15)}
                >
                  <Clock3 size={15} />
                  <span>延后 15 分</span>
                </button>
              </div>
              <div className={`reminder-receipt ${planSync.deliveryReceipt.state}`} aria-label="提醒回执">
                <span>{planSync.deliveryReceipt.label}</span>
                <strong>{planSync.deliveryReceipt.detail}</strong>
                <small>{planSync.deliveryReceipt.hint}</small>
              </div>
              <div className="reminder-panel-actions" role="group" aria-label="提醒队列恢复操作">
                <button
                  className={
                    planSync.status.failed ? "ghost-button hot-action" : "ghost-button dimmed-action"
                  }
                  type="button"
                  onClick={() => planSync.recoverQueue("retryFailed")}
                >
                  <RefreshCw size={15} />
                  <span>重试失败 {planSync.status.failed || ""}</span>
                </button>
                <button
                  className={
                    planSync.status.stalePending ? "ghost-button hot-action" : "ghost-button dimmed-action"
                  }
                  type="button"
                  onClick={() => planSync.recoverQueue("clearStale")}
                >
                  <X size={15} />
                  <span>清理过期 {planSync.status.stalePending || ""}</span>
                </button>
              </div>
              <div className="reminder-health" aria-label="提醒健康检查">
                {planSync.healthChecks.map((check) => (
                  <span key={check.id} className={check.state}>
                    <small>{check.label}</small>
                    <strong>{check.detail}</strong>
                  </span>
                ))}
              </div>
              <div className="reminder-panel-grid">
                <div>
                  <span className="reminder-kicker">接下来</span>
                  <div className="reminder-list">
                    {(planSync.status.upcoming || []).length ? (
                      planSync.status.upcoming.slice(0, 4).map((reminder) => (
                        <span key={reminder.id} className="reminder-row">
                          <em>{reminderTimeLabel(reminder.fireAt)}</em>
                          <strong>{reminder.title}</strong>
                          <small>
                            {reminderKindLabel(reminder.kind)} · {reminder.channel}
                          </small>
                        </span>
                      ))
                    ) : (
                      <span className="reminder-empty">暂无待发提醒，写入未来时间块后会自动生成。</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="reminder-kicker">需要处理</span>
                  <div className="reminder-list">
                    {(planSync.status.recentFailures || []).length ? (
                      planSync.status.recentFailures.slice(0, 3).map((reminder) => (
                        <span key={reminder.id} className="reminder-row failed">
                          <em>{reminderTimeLabel(reminder.fireAt)}</em>
                          <strong>{reminder.title}</strong>
                          <small>{reminder.lastError || "发送失败，检查 Bark key 或网络"}</small>
                        </span>
                      ))
                    ) : (
                      <span className="reminder-empty">没有失败记录。</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {aiInbox.warning && <div className="inline-note warning-note">{aiInbox.warning}</div>}
          {aiInbox.draft && (
            <div className="draft-card">
              <div className="draft-head">
                <strong>{aiInbox.draft.goal || "AI 草稿"}</strong>
                <button type="button" aria-label="关闭 AI 草稿" onClick={() => aiInbox.setDraft(null)}>
                  <X size={15} />
                </button>
              </div>
              <div className="draft-blocks">
                {aiInbox.draft.blocks.slice(0, 5).map((block) => (
                  <span key={`${block.title}-${block.start}`}>
                    {block.start}-{block.end} {block.title}
                  </span>
                ))}
              </div>
              {aiInbox.draft.reviewQuestions?.length > 0 && (
                <p className="draft-review">{aiInbox.draft.reviewQuestions[0]}</p>
              )}
              <button className="primary-button full" type="button" onClick={applyAIDraft}>
                <Send size={17} />
                <span>确认写入规划</span>
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="hero-grid">
        <div className="goal-panel">
          <div className="panel-kicker">
            <CalendarDays size={16} />
            <div className="date-control" role="group" aria-label="日期翻页">
              <button
                type="button"
                title="前一天"
                aria-label="切换到前一天"
                onClick={() => shiftSelectedDate(-1)}
              >
                <ChevronLeft size={17} />
              </button>
              <input
                aria-label="规划日期"
                name="plan-date"
                autoComplete="off"
                type="date"
                value={plan.selectedDate}
                onChange={(event) => selectDate(event.target.value)}
              />
              <button
                type="button"
                title="后一天"
                aria-label="切换到后一天"
                onClick={() => shiftSelectedDate(1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <label className="goal-label" htmlFor="daily-goal">
            {isSelectedToday ? "今日目标" : "当日目标"}
          </label>
          <textarea
            ref={dailyGoalRef}
            id="daily-goal"
            name="daily-goal"
            autoComplete="off"
            maxLength={MAX_GOAL_LENGTH}
            value={currentDay.goal}
            onChange={(event) => updateDay({ goal: event.target.value })}
            rows={2}
          />
          <div className="status-row" style={{ "--completion": `${completion}%` }}>
            <div aria-live="polite" aria-atomic="true">
              <ShieldCheck size={17} />
              <span>{statusCopy}</span>
            </div>
            <strong>{completion}%</strong>
          </div>
        </div>

        <div className="metric-strip">
          <Metric label="规划" value={formatMinutes(stats.plannedMinutes)} />
          <Metric label="完成" value={`${stats.doneBlocks}/${stats.totalBlocks}`} />
          <Metric label="冲突" value={String(overlaps.size)} alert={overlaps.size > 0} />
        </div>
      </section>

      <section className="workspace" id="planner-workspace" tabIndex={-1}>
        <aside className="composer" aria-labelledby="composer-title">
          <div className="section-title">
            <Sparkles size={17} />
            <h2 id="composer-title">新时间块</h2>
          </div>
          <form onSubmit={addBlock}>
            <input
              ref={blockTitleRef}
              aria-label="时间块标题"
              name="block-title"
              autoComplete="off"
              maxLength={MAX_TITLE_LENGTH}
              aria-invalid={formErrors.title || undefined}
              aria-describedby={formErrors.title ? "block-title-error" : undefined}
              placeholder="比如：写方案…"
              value={form.title}
              onChange={(event) => {
                setForm({ ...form, title: event.target.value });
                if (formErrors.title) setFormErrors((current) => ({ ...current, title: false }));
              }}
            />
            <div className="time-pair">
              <label>
                <span>开始</span>
                <input
                  ref={blockStartRef}
                  type="time"
                  aria-label="新时间块开始时间"
                  name="block-start"
                  autoComplete="off"
                  aria-invalid={formErrors.start || undefined}
                  aria-describedby={formErrors.start ? "block-start-error" : undefined}
                  value={form.start}
                  onChange={(event) => {
                    setForm({ ...form, start: event.target.value });
                    if (formErrors.start) setFormErrors((current) => ({ ...current, start: false }));
                  }}
                />
              </label>
              <label>
                <span>结束</span>
                <input
                  ref={blockEndRef}
                  type="time"
                  aria-label="新时间块结束时间"
                  name="block-end"
                  autoComplete="off"
                  aria-invalid={formErrors.end || undefined}
                  aria-describedby={formErrors.end ? "block-end-error" : undefined}
                  value={form.end}
                  onChange={(event) => {
                    setForm({ ...form, end: event.target.value });
                    if (formErrors.end) setFormErrors((current) => ({ ...current, end: false }));
                  }}
                />
              </label>
            </div>
            <div className="form-errors" aria-live="polite">
              {formErrors.title && <p id="block-title-error">请先给时间块起个名字。</p>}
              {formErrors.start && (
                <p id="block-start-error">请填写有效的开始时间；今天不能从已经过去的时间开始。</p>
              )}
              {formErrors.end && <p id="block-end-error">结束时间要晚于开始时间；跨午夜请拆成两段。</p>}
            </div>
            <div className="type-grid" role="group" aria-label="时间块类型">
              {Object.entries(blockTypes).map(([key, type]) => (
                <button
                  key={key}
                  className={form.type === key ? `type-chip ${type.tone} selected` : `type-chip ${type.tone}`}
                  type="button"
                  aria-pressed={form.type === key}
                  onClick={() => setForm({ ...form, type: key })}
                >
                  {type.label}
                </button>
              ))}
            </div>
            <button
              className="ghost-button full"
              type="button"
              aria-label={isSelectedToday ? "推荐今天的下一个可用空档" : "推荐当日的可用空档"}
              onClick={useSuggestedSlot}
            >
              智能空档
            </button>
            <textarea
              aria-label="新时间块备注"
              name="block-note"
              autoComplete="off"
              maxLength={MAX_NOTE_LENGTH}
              placeholder="一句话备注，可不填…"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              rows={2}
            />
            <button className="primary-button full" type="submit">
              <Plus size={17} />
              <span>加入规划</span>
            </button>
          </form>

          <div className="utility-row">
            <button
              ref={importToggleRef}
              type="button"
              aria-label={importOpen ? "关闭粘贴导入" : "打开粘贴导入"}
              aria-expanded={importOpen}
              aria-controls={importOpen ? "paste-import-panel" : undefined}
              onClick={toggleImportPanel}
            >
              {importOpen ? "关闭导入" : "粘贴导入"}
            </button>
            <button
              type="button"
              aria-label={isSelectedToday ? "重置今日规划" : "清空当日规划"}
              onClick={resetDay}
            >
              重置
            </button>
          </div>

          {importOpen && (
            <div className="import-box" id="paste-import-panel">
              <textarea
                ref={importTextAreaRef}
                aria-label="粘贴 Time Goalie JSON"
                name="plan-import-json"
                autoComplete="off"
                spellCheck={false}
                placeholder="粘贴导出的 JSON…"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeImportPanel();
                }}
                rows={5}
              />
              <button type="button" onClick={submitTextImport}>
                应用导入
              </button>
            </div>
          )}
        </aside>

        <section ref={timelinePanelRef} className="timeline-panel" aria-labelledby="timeline-title">
          <div className="section-title timeline-title">
            <Clock3 size={17} />
            <h2 id="timeline-title">{isSelectedToday ? "今日防线" : "当日防线"}</h2>
            <span>{timelineMeta}</span>
            {(planSync.status.pending > 0 || planSync.status.failed > 0) && (
              <em className={planSync.status.failed ? "reminder-badge failed" : "reminder-badge"}>
                <BellRing size={13} />
                {planSync.status.failed ? planSync.status.failed : planSync.status.pending}
              </em>
            )}
          </div>

          {selectedBlockIds.size > 0 && (
            <div className="batch-bar" role="toolbar" aria-label="批量操作">
              <span>已选 {selectedBlockIds.size} 个</span>
              <div className="batch-actions">
                <button type="button" onClick={batchComplete}>
                  完成
                </button>
                <button type="button" onClick={batchSkip}>
                  跳过
                </button>
                <button type="button" onClick={batchDelete}>
                  删除
                </button>
                <button type="button" onClick={() => setSelectedBlockIds(new Set())}>
                  取消
                </button>
              </div>
            </div>
          )}

          <div
            className="timeline"
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
          >
            {timelineHover && (
              <div className="timeline-hover-indicator" style={{ top: timelineHover.top }}>
                <span>{timelineHover.time}</span>
              </div>
            )}
            {timelineHover && (
              <div
                className="timeline-ghost"
                style={blockTimelineStyle(
                  timelineHover.time,
                  toTime(Math.min(DAY_END_MINUTES, toMinutes(timelineHover.time) + 60)),
                )}
                aria-hidden="true"
              >
                <div className="timeline-ghost-inner">
                  <span>{timelineHover.time}</span>
                  <span>点击创建</span>
                </div>
              </div>
            )}
            <div className="timeline-marks" aria-hidden="true">
              {timelineMarks.map((mark) => (
                <span key={mark} style={{ top: `${clampTimelinePercent(mark)}%` }}>
                  {mark}
                </span>
              ))}
            </div>
            {isSelectedToday && (
              <div className="now-line" style={{ top: `${currentPercent}%` }}>
                <span>现在</span>
                <span className="now-dot" aria-hidden="true" />
              </div>
            )}
            {blocks.length === 0 ? (
              <div className="empty-state">
                <Circle size={22} />
                <p>先放下第一个时间块。</p>
                <button className="ghost-button" type="button" onClick={resetDay}>
                  {isSelectedToday ? "添加示例规划" : "清空当日规划"}
                </button>
              </div>
            ) : (
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                {blocks.map((block, index) => {
                  const layout = overlapLayout.get(block.id);
                  const style = {
                    ...blockTimelineStyle(block.start, block.end),
                    "--overlap-column": layout?.column ?? 0,
                    "--overlap-total": layout?.totalColumns ?? 1,
                  };
                  return (
                    <SortableTimeBlock
                      key={block.id}
                      block={block}
                      style={style}
                      activeWrapper={activeBlock?.id === block.id}
                    >
                      <TimeBlock
                        block={block}
                        blockIndex={index}
                        active={activeBlock?.id === block.id}
                        overlapping={overlaps.has(block.id)}
                        overlapDetails={overlapDetails.get(block.id)}
                        selected={selectedBlockIds.has(block.id)}
                        dimmed={filteredBlockIds != null && !filteredBlockIds.has(block.id)}
                        pomodoroEndTime={pomodoro?.blockId === block.id ? pomodoro.endTime : null}
                        onPatch={(patch) => patchBlock(block.id, patch)}
                        onStatus={(status, restoreFocusTarget) =>
                          updateBlockStatus(block.id, status, restoreFocusTarget)
                        }
                        onRemove={() => removeBlock(block.id)}
                        onDuplicate={() => duplicateBlock(block.id)}
                        onToggleSelect={() => toggleBlockSelection(block.id)}
                        onTogglePomodoro={
                          activeBlock?.id === block.id ? () => togglePomodoro(block) : undefined
                        }
                        onPomodoroExpire={expirePomodoro}
                        registerActionRef={registerActionRef}
                        registerTitleRef={registerTitleRef}
                      />
                    </SortableTimeBlock>
                  );
                })}
                <DragOverlay dropAnimation={null}>
                  {activeDragId ? (
                    <div className="drag-overlay-block">
                      {(() => {
                        const block = blocks.find((b) => b.id === activeDragId);
                        if (!block) return null;
                        const type = blockTypes[block.type] || blockTypes.deep;
                        return (
                          <div className="drag-overlay-inner" style={{ borderLeftColor: type.color }}>
                            <span className="drag-overlay-time">
                              {block.start} – {block.end}
                            </span>
                            <span className="drag-overlay-title">{block.title || "（未命名）"}</span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
          <div className="daily-closeout" aria-label="每日收口">
            <span>{dailyCloseout.label}</span>
            <strong>{dailyCloseout.suggestion}</strong>
            <small>
              三分钟复盘 · 完成 {dailyCloseout.doneLabel}
              {dailyCloseout.skipped ? ` · 跳过 ${dailyCloseout.skipped}` : ""}
            </small>
            <button
              className={
                dailyCloseout.unfinishedCount ? "ghost-button hot-action" : "ghost-button dimmed-action"
              }
              type="button"
              onClick={carryOverTomorrow}
            >
              <CalendarPlus size={15} />
              <span>{dailyCloseout.actionLabel}</span>
            </button>
            {visibleCloseoutResult && (
              <div className="closeout-result" aria-label="承接结果">
                <span>
                  已承接 {visibleCloseoutResult.count} 个到 {visibleCloseoutResult.targetDate.slice(5)}
                </span>
                <button type="button" onClick={openCloseoutResult}>
                  查看
                </button>
              </div>
            )}
          </div>
        </section>
      </section>

      {firstRunSetup.open && (
        <div className="setup-backdrop" role="presentation">
          <section className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <div className="setup-dialog-head">
              <div>
                <span className="setup-kicker">First run</span>
                <h2 id="setup-title">连接提醒和 AI 后端</h2>
              </div>
              <button type="button" aria-label="稍后配置" onClick={() => firstRunSetup.setOpen(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="setup-grid">
              <label className="setup-field">
                <span>Bark Key / URL</span>
                <input
                  name="setup-bark-key"
                  type="password"
                  autoComplete="off"
                  value={firstRunSetup.form.barkKey}
                  placeholder={firstRunSetup.status?.hasBarkKey ? "已保存，留空不改" : "Bark key 或完整 URL"}
                  onChange={(event) => firstRunSetup.patchForm({ barkKey: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>Bark Server</span>
                <input
                  name="setup-bark-server"
                  autoComplete="off"
                  value={firstRunSetup.form.barkServer}
                  onChange={(event) => firstRunSetup.patchForm({ barkServer: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>Bark 级别</span>
                <select
                  name="setup-bark-level"
                  value={firstRunSetup.form.barkLevel}
                  onChange={(event) => firstRunSetup.patchForm({ barkLevel: event.target.value })}
                >
                  <option value="timeSensitive">准时提醒</option>
                  <option value="active">普通提醒</option>
                  <option value="passive">安静提醒</option>
                </select>
              </label>
              <label className="setup-field">
                <span>Bark 声音</span>
                <input
                  name="setup-bark-sound"
                  autoComplete="off"
                  value={firstRunSetup.form.barkSound}
                  placeholder="默认 / alarm / bell"
                  onChange={(event) => firstRunSetup.patchForm({ barkSound: event.target.value })}
                />
              </label>
              <label className="setup-field wide">
                <span>AI API Key</span>
                <input
                  name="setup-ai-key"
                  type="password"
                  autoComplete="off"
                  value={firstRunSetup.form.aiApiKey}
                  placeholder={
                    firstRunSetup.status?.hasAiKey ? "已保存，留空不改" : "OpenAI-compatible API key"
                  }
                  onChange={(event) => firstRunSetup.patchForm({ aiApiKey: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>Endpoint</span>
                <input
                  name="setup-ai-base"
                  autoComplete="off"
                  value={firstRunSetup.form.aiBaseUrl}
                  onChange={(event) => firstRunSetup.patchForm({ aiBaseUrl: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>Model</span>
                <input
                  name="setup-ai-model"
                  autoComplete="off"
                  value={firstRunSetup.form.aiModel}
                  onChange={(event) => firstRunSetup.patchForm({ aiModel: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>提前提醒</span>
                <input
                  name="setup-leads"
                  inputMode="numeric"
                  value={firstRunSetup.form.reminderLeadMinutes}
                  onChange={(event) => firstRunSetup.patchForm({ reminderLeadMinutes: event.target.value })}
                />
              </label>
              <label className="setup-field">
                <span>静默开始</span>
                <input
                  name="setup-quiet-start"
                  type="time"
                  value={firstRunSetup.form.quietHours.start}
                  onChange={(event) =>
                    firstRunSetup.patchForm({
                      quietHours: { ...firstRunSetup.form.quietHours, start: event.target.value },
                    })
                  }
                />
              </label>
            </div>

            <div className="channel-row setup-channels" role="group" aria-label="默认提醒通道">
              {[
                ["bark", "Bark"],
                ["webPush", "Web Push"],
                ["inApp", "站内"],
              ].map(([key, label]) => (
                <label key={key} className="channel-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(firstRunSetup.form.channels[key])}
                    onChange={(event) =>
                      firstRunSetup.patchForm({
                        channels: { [key]: event.target.checked },
                      })
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
              <label className="channel-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(firstRunSetup.form.quietHours.enabled)}
                  onChange={(event) =>
                    firstRunSetup.patchForm({
                      quietHours: { ...firstRunSetup.form.quietHours, enabled: event.target.checked },
                    })
                  }
                />
                <span>静默</span>
              </label>
              <label className="channel-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(firstRunSetup.form.barkArchive)}
                  onChange={(event) => firstRunSetup.patchForm({ barkArchive: event.target.checked })}
                />
                <span>Bark 留档</span>
              </label>
            </div>

            <p className="setup-note">
              保存后会写入 <code>.env.local</code>，并同步到当前后端进程；之后主页面不再显示密钥表单。
            </p>

            <div className="setup-actions">
              <button
                className="primary-button"
                type="button"
                disabled={firstRunSetup.saving}
                onClick={firstRunSetup.save}
              >
                <Settings2 size={16} />
                <span>{firstRunSetup.saving ? "保存中" : "保存并开始"}</span>
              </button>
              <button className="ghost-button" type="button" onClick={testBarkAndRefresh}>
                <BellRing size={16} />
                <span>测试 Bark</span>
              </button>
              <button className="ghost-button" type="button" onClick={reminderSettings.enableWebPush}>
                <Radio size={16} />
                <span>订阅 Web Push</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div
          className={`toast ${toast.actionLabel ? "toast-long" : ""}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          onFocus={() => setToastPaused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setToastPaused(false);
          }}
        >
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button type="button" onClick={toast.onAction}>
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

export default App;
