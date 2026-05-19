import { useEffect, useState } from "react";
import { getSettings, putSettings, subscribePush, testReminder } from "../api.js";

const DEFAULT_SETTINGS = {
  channels: { bark: false, webPush: false, inApp: true },
  bark: {
    key: "",
    server: "https://api.day.app",
    configured: false,
    level: "timeSensitive",
    sound: "",
    archive: true,
  },
  webPush: { publicKey: "", enabled: false },
  reminderLeadMinutes: [10, 0],
  quietHours: { enabled: false, start: "22:30", end: "07:00" },
  ai: { baseUrl: "", model: "", configured: false },
};

export function useReminderSettings(onToast) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("offline");

  useEffect(() => {
    getSettings()
      .then((payload) => {
        setSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
        setStatus("online");
      })
      .catch(() => setStatus("offline"));
  }, []);

  async function saveSettings(nextSettings = settings) {
    try {
      const payload = await putSettings(nextSettings);
      setSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
      setStatus("online");
      onToast?.("自动化设置已保存");
    } catch {
      setStatus("offline");
      onToast?.("设置保存失败：请先启动后端");
    }
  }

  async function sendTest(channel) {
    try {
      const payload = await testReminder(channel);
      onToast?.(payload.channel === "bark" ? "Bark 测试已发出，请看手机" : "测试提醒已发送");
      return payload;
    } catch (error) {
      onToast?.(error.message || "测试提醒失败，请检查配置");
      return null;
    }
  }

  async function enableWebPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      onToast?.("当前浏览器不支持 Web Push");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(settings.webPush.publicKey),
      });
      await subscribePush(subscription.toJSON());
      const next = { ...settings, channels: { ...settings.channels, webPush: true } };
      setSettings(next);
      await saveSettings(next);
      onToast?.("Web Push 已订阅");
    } catch (error) {
      onToast?.(error.message || "Web Push 订阅失败");
    }
  }

  return { settings, setSettings, status, saveSettings, sendTest, enableWebPush };
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
