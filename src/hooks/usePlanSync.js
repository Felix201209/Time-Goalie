import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportIcs,
  recoverReminders,
  scheduleReminders,
  schedulerStatus,
  snoozeReminder,
  syncPlan,
} from "../api.js";
import { downloadBlob } from "../closedLoop.js";

export function usePlanSync(plan, onToast) {
  const [status, setStatus] = useState({
    online: false,
    pending: 0,
    delivered: 0,
    failed: 0,
    subscriptions: 0,
    bark: null,
    nextReminder: null,
    upcoming: [],
    recentFailures: [],
    stalePending: 0,
    lastDeliveries: [],
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await syncPlan(plan);
        const scheduled = await scheduleReminders({ plan, date: plan.selectedDate });
        if (!cancelled) {
          const brief = briefFromReminders(scheduled.reminders || []);
          setStatus((current) => ({
            ...current,
            online: true,
            pending: brief.pending,
            failed: brief.failed,
            delivered: brief.delivered,
            nextReminder: brief.nextReminder,
            upcoming: brief.upcoming,
            recentFailures: brief.recentFailures,
            stalePending: brief.stalePending,
          }));
        }
      } catch {
        if (!cancelled) setStatus((current) => ({ ...current, online: false }));
      }
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [plan]);

  const refreshStatus = useCallback(async () => {
    const payload = await schedulerStatus();
    setStatus({ online: true, ...payload });
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const payload = await schedulerStatus();
        if (!cancelled) setStatus({ online: true, ...payload });
      } catch {
        if (!cancelled) setStatus((current) => ({ ...current, online: false }));
      }
    }
    poll();
    const timer = window.setInterval(poll, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const summary = useMemo(() => {
    if (!status.online) return "后端未连接";
    if (status.failed) return `${status.pending} 待发 · ${status.failed} 失败`;
    return `${status.pending} 待发 · ${status.delivered} 已送达`;
  }, [status]);

  const barkSummary = useMemo(() => {
    if (!status.online) return "Bark 未连接";
    if (!status.bark?.configured) return "Bark 未配置";
    if (!status.bark?.enabled) return "Bark 已保存 · 未启用";
    if (status.bark?.recentFailures) return `Bark 异常 ${status.bark.recentFailures}`;
    return status.bark?.level ? `Bark ${status.bark.level}` : "Bark 守门中";
  }, [status]);

  const nextReminderLabel = useMemo(() => {
    if (!status.online) return "后端未连接";
    if (!status.nextReminder) return status.pending ? "等待同步提醒队列" : "暂无待发提醒";
    const date = new Date(status.nextReminder.fireAt);
    const time = date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${time} · ${status.nextReminder.title || "Time Goalie"}`;
  }, [status]);

  const healthChecks = useMemo(
    () => [
      {
        id: "backend",
        label: "后端",
        state: status.online ? "ok" : "warn",
        detail: status.online ? "在线同步" : "未连接",
      },
      {
        id: "bark",
        label: "Bark",
        state: status.bark?.enabled && status.bark?.configured ? "ok" : "warn",
        detail: status.bark?.enabled && status.bark?.configured ? "手机可达" : "未启用",
      },
      {
        id: "queue",
        label: "队列",
        state: status.nextReminder || status.pending > 0 ? "ok" : "idle",
        detail: status.nextReminder ? "已排下一条" : "暂无待发",
      },
      {
        id: "failures",
        label: "失败",
        state: status.failed > 0 ? "warn" : "ok",
        detail: status.failed > 0 ? `${status.failed} 条待处理` : "干净",
      },
    ],
    [status],
  );

  const deliveryReceipt = useMemo(() => {
    const last = status.lastDeliveries?.[0];
    const next = status.nextReminder;
    const nextDate = next ? new Date(next.fireAt) : null;
    const nextLabel =
      nextDate && !Number.isNaN(nextDate.getTime())
        ? nextDate.toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : "";
    if (!status.online) {
      return { state: "warn", label: "最近回执", detail: "后端未连接", hint: "启动 dev:full 后再测试。" };
    }
    if (!status.bark?.configured) {
      return { state: "warn", label: "Bark 回执", detail: "Bark 未配置", hint: "去配置里粘贴 Key。" };
    }
    const nextHint = next
      ? `下次 ${nextLabel} ${next.channel === "bark" ? "会推送到手机" : `走 ${next.channel}`}`
      : "暂无待发提醒，记录未来时间块后会排队。";
    if (!last) {
      return {
        state: "idle",
        label: "最近回执",
        detail: "暂无测试记录",
        hint: nextHint,
      };
    }
    const time = new Date(last.at).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const isFailed = last.status === "failed";
    return {
      state: isFailed ? "warn" : "ok",
      label: last.channel === "bark" ? "Bark 回执" : "提醒回执",
      detail: `${isFailed ? "上次失败" : "上次送达"} ${time}`,
      hint: isFailed ? last.message || "检查 Bark key、Server 或网络。" : nextHint,
    };
  }, [status]);

  async function downloadIcs() {
    try {
      const blob = await exportIcs(plan, plan.selectedDate);
      downloadBlob(blob, `time-goalie-${plan.selectedDate}.ics`);
      onToast?.("ICS 日历已导出");
    } catch {
      onToast?.("ICS 导出需要启动后端服务");
    }
  }

  async function recoverQueue(action) {
    try {
      const payload = await recoverReminders(action);
      setStatus({ online: true, ...payload.status });
      if (action === "retryFailed") onToast?.(`已重新排队 ${payload.count} 条失败提醒`);
      if (action === "clearStale") onToast?.(`已清理 ${payload.count} 条过期待发`);
    } catch (error) {
      onToast?.(error.message || "提醒队列恢复失败");
    }
  }

  async function snoozeNext(minutes = 15) {
    try {
      const payload = await snoozeReminder(minutes);
      setStatus({ online: true, ...payload.status });
      onToast?.(`已延后 ${minutes} 分钟：${payload.reminder?.title || "下一条提醒"}`);
    } catch (error) {
      onToast?.(`延后失败：${error.message || "暂无待发的未来提醒"}`);
    }
  }

  return {
    status,
    summary,
    barkSummary,
    nextReminderLabel,
    healthChecks,
    deliveryReceipt,
    refreshStatus,
    downloadIcs,
    recoverQueue,
    snoozeNext,
  };
}

function briefFromReminders(reminders) {
  const now = new Date();
  const pendingItems = reminders
    .filter((reminder) => reminder.status === "pending" && new Date(reminder.fireAt) >= now)
    .sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt));
  const failedItems = reminders
    .filter((reminder) => reminder.status === "failed")
    .sort((a, b) => new Date(b.fireAt) - new Date(a.fireAt));
  const stalePending = reminders.filter(
    (reminder) => reminder.status === "pending" && new Date(reminder.fireAt) < now,
  ).length;
  return {
    pending: pendingItems.length,
    failed: failedItems.length,
    delivered: reminders.filter((reminder) => reminder.status === "delivered").length,
    nextReminder: pendingItems[0] || null,
    upcoming: pendingItems.slice(0, 5),
    recentFailures: failedItems.slice(0, 5),
    stalePending,
  };
}
