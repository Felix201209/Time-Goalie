import { useEffect, useState } from "react";
import { getWorkflows, parseInboxText } from "../api.js";
import { FALLBACK_WORKFLOWS } from "../closedLoop.js";

export function useAIInbox({ plan, selectedDate, onToast }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState(null);
  const [warning, setWarning] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [workflows, setWorkflows] = useState(FALLBACK_WORKFLOWS);

  useEffect(() => {
    getWorkflows()
      .then((payload) => setWorkflows(payload.workflows || FALLBACK_WORKFLOWS))
      .catch(() => setWorkflows(FALLBACK_WORKFLOWS));
  }, []);

  async function parseText(nextText = text) {
    const input = String(nextText || "").trim();
    if (!input) {
      onToast?.("先输入一段想法、笔记或任务");
      return null;
    }
    setIsParsing(true);
    setWarning("");
    try {
      const payload = await parseInboxText({ text: input, selectedDate, plan });
      setDraft(payload.draft);
      setWarning(payload.warning || "");
      onToast?.(payload.source === "ai" ? "AI 草稿已生成" : "本地规则草稿已生成");
      return payload.draft;
    } catch (error) {
      setWarning(error.message);
      onToast?.("AI 收件箱暂时不可用");
      return null;
    } finally {
      setIsParsing(false);
    }
  }

  return {
    text,
    setText,
    draft,
    setDraft,
    warning,
    isParsing,
    workflows,
    parseText,
  };
}
