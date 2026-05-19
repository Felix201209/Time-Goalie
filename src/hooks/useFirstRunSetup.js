import { useEffect, useMemo, useState } from "react";
import { getSetup, saveSetup } from "../api.js";

const DEFAULT_FORM = {
  barkKey: "",
  barkServer: "https://api.day.app",
  aiApiKey: "",
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-4o-mini",
  channels: { bark: false, webPush: false, inApp: true },
  barkLevel: "timeSensitive",
  barkSound: "",
  barkArchive: true,
  reminderLeadMinutes: "10,0",
  quietHours: { enabled: false, start: "22:30", end: "07:00" },
};

export function useFirstRunSetup(onToast) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetup()
      .then(({ setup }) => {
        if (cancelled) return;
        setStatus(setup);
        setForm(formFromSetup(setup));
        if (setup.needsSetup) setOpen(true);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    if (!status) return "后端未连接";
    const ai = status.hasAiKey ? "AI 已配置" : "本地解析";
    const bark = status.hasBarkKey ? "Bark 已保存" : "Bark 未配置";
    return `${ai} · ${bark}`;
  }, [status]);

  function patchForm(patch) {
    setForm((current) => ({
      ...current,
      ...patch,
      channels: { ...current.channels, ...(patch.channels || {}) },
      quietHours: { ...current.quietHours, ...(patch.quietHours || {}) },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = await saveSetup({
        ...form,
        reminderLeadMinutes: parseLeadMinutes(form.reminderLeadMinutes),
      });
      setStatus(payload.setup);
      setForm(formFromSetup(payload.setup));
      setOpen(false);
      onToast?.("配置已保存到 .env.local");
    } catch (error) {
      onToast?.(error.message || "配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return { open, setOpen, status, form, patchForm, saving, save, summary };
}

function formFromSetup(setup) {
  const settings = setup?.settings || {};
  return {
    ...DEFAULT_FORM,
    barkKey: "",
    barkServer: settings.bark?.server || DEFAULT_FORM.barkServer,
    aiApiKey: "",
    aiBaseUrl: settings.ai?.baseUrl || DEFAULT_FORM.aiBaseUrl,
    aiModel: settings.ai?.model || DEFAULT_FORM.aiModel,
    channels: { ...DEFAULT_FORM.channels, ...settings.channels },
    barkLevel: settings.bark?.level || DEFAULT_FORM.barkLevel,
    barkSound: settings.bark?.sound || "",
    barkArchive: settings.bark?.archive !== false,
    reminderLeadMinutes: (settings.reminderLeadMinutes || [10, 0]).join(","),
    quietHours: { ...DEFAULT_FORM.quietHours, ...settings.quietHours },
  };
}

function parseLeadMinutes(value) {
  const parsed = String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 180);
  return parsed.length ? parsed : [10, 0];
}
