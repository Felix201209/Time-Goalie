import { useEffect, useMemo, useState } from "react";
import { exportIcs, scheduleReminders, schedulerStatus, syncPlan } from "../api.js";
import { downloadBlob } from "../closedLoop.js";

export function usePlanSync(plan, onToast) {
  const [status, setStatus] = useState({
    online: false,
    pending: 0,
    delivered: 0,
    failed: 0,
    subscriptions: 0,
    lastDeliveries: [],
  });

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await syncPlan(plan);
        const scheduled = await scheduleReminders({ plan, date: plan.selectedDate });
        if (!cancelled) {
          setStatus((current) => ({
            ...current,
            online: true,
            pending: scheduled.reminders?.filter((r) => r.status === "pending").length ?? current.pending,
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

  async function downloadIcs() {
    try {
      const blob = await exportIcs(plan, plan.selectedDate);
      downloadBlob(blob, `time-goalie-${plan.selectedDate}.ics`);
      onToast?.("ICS 日历已导出");
    } catch {
      onToast?.("ICS 导出需要启动后端服务");
    }
  }

  return { status, summary, downloadIcs };
}
