import { addDaysISO, isISODate, todayISO } from "./storage.js";

export const FALLBACK_WORKFLOWS = [
  { id: "messy-input", title: "混乱输入生成今日计划", action: "把一段乱输入整理成目标、时间块和提醒" },
  { id: "markdown-extract", title: "长文本 / Markdown 提取", action: "从笔记里抽任务、时间和复盘问题" },
  { id: "auto-schedule", title: "一键智能排期", action: "自动避开冲突并填入今日空档" },
  { id: "bark-guard", title: "Bark 守门提醒", action: "提前、开始、超时都能推到手机" },
  { id: "web-push", title: "Web Push 兜底", action: "PWA/浏览器也能收到提醒" },
  { id: "focus-guard", title: "当前块 Focus 守门", action: "开始倒计时，结束后立刻复盘" },
  { id: "missed-rescue", title: "错过任务自动救援", action: "检测错过块并生成重排建议" },
  { id: "morning-brief", title: "每日早间 Brief", action: "早上自动推送今日防线" },
  { id: "evening-review", title: "晚间 Review", action: "总结完成率、拖延项和下一步" },
  { id: "carry-over", title: "明日 Carry-over", action: "未完成任务变成明日草稿" },
  { id: "template-library", title: "模板库", action: "学习、项目、运动、考试、创作、杂务快速套用" },
  { id: "export-loop", title: "导出闭环", action: "Markdown、JSON、ICS 都能带走" },
];

export const TEMPLATE_PROMPTS = {
  reading: "我要做读书规划：选定页数、深读、摘录、输出、复盘和明日续读，请生成闭环计划。",
  study: "我要安排一个学习日：预习、复习、刷题、整理错题、晚间复盘，请帮我生成今日计划。",
  project: "我要推进一个项目：明确目标、深度工作、沟通、交付检查，请帮我排成时间块。",
  health: "我要安排健康提醒：吃药、喝水、拉伸、记录症状、晚间检查，请生成闭环计划。",
  finance: "我要处理账单和财务：检查账户、缴费、记录、备份凭证、复盘风险，请帮我排期。",
  social: "我要做关系跟进：回消息、准备沟通、联系重要的人、记录承诺，请生成闭环计划。",
  exercise: "我要安排运动和恢复：热身、训练、拉伸、补水、记录，请生成计划。",
  exam: "我要备考：背诵、题目训练、错题复盘、模拟检查，请生成可执行安排。",
  creator: "我要做创作：选题、写作、编辑、发布、复盘数据，请生成闭环计划。",
  admin: "我要处理杂务：邮件、文件、账单、整理、明日准备，请帮我排期。",
  travel: "我要准备出行：证件、路线、打包、费用、提醒和备份，请生成闭环计划。",
  habit: "我要建立习惯：最小行动、触发提醒、记录、复盘和明日继续，请生成闭环计划。",
};

export const CLOSED_LOOP_TEMPLATES = [
  {
    id: "reading",
    label: "读书",
    summary: "读完、摘录、输出、续读",
    goal: "读书闭环：不是翻过，而是留下可复用的理解",
    blocks: [
      ["选书与页数", "09:00", "09:15", "deep", "定下今天读到哪里，写下一个想回答的问题。"],
      ["深读主段落", "09:20", "10:05", "deep", "手机远离，边读边标记关键论点。"],
      ["摘录 3 条卡片", "10:10", "10:35", "ship", "只摘能改变行动或判断的句子。"],
      ["输出 150 字理解", "10:40", "11:05", "ship", "用自己的话写一个可分享的小结。"],
      ["复盘与续读提醒", "21:20", "21:35", "review", "检查今天是否真的吸收，安排明天页数。"],
    ],
    reviewQuestions: ["这本书今天真正改变了我哪个判断？", "明天从哪一页继续，为什么？"],
  },
  {
    id: "study",
    label: "学习",
    summary: "预习、刷题、错题、复盘",
    goal: "学习闭环：先理解，再训练，最后把错因沉淀下来",
    blocks: [
      ["预习目标与目录", "08:30", "08:50", "deep", "把今天要学的范围缩成 3 个问题。"],
      ["核心概念学习", "09:00", "09:50", "deep", "只攻最难懂的一块。"],
      ["题目训练", "10:05", "10:50", "ship", "限时做题，不查答案。"],
      ["错题归因", "11:00", "11:35", "review", "分成概念错、计算错、审题错。"],
      ["晚间回忆", "20:30", "20:50", "review", "合上资料复述今天的结构。"],
    ],
    reviewQuestions: ["今天最容易再次犯的错是什么？", "明天第一题应该练哪类？"],
  },
  {
    id: "project",
    label: "项目",
    summary: "目标、深工、检查、交付",
    goal: "项目推进闭环：每天必须留下一个可验收增量",
    blocks: [
      ["定义今日交付物", "09:00", "09:20", "deep", "写清楚今天完成后能被看见的东西。"],
      ["深度推进", "09:30", "11:00", "deep", "关闭分心入口，只做关键路径。"],
      ["边界检查", "11:10", "11:35", "review", "检查 bug、遗漏、下一步依赖。"],
      ["沟通同步", "15:00", "15:25", "admin", "发出需要别人知道的进展或阻塞。"],
      ["交付复核", "18:00", "18:25", "ship", "确认能打开、能演示、能复现。"],
    ],
    reviewQuestions: ["今天的增量别人能一眼看懂吗？", "明天的唯一关键路径是什么？"],
  },
  {
    id: "health",
    label: "健康",
    summary: "吃药、喝水、拉伸、记录",
    goal: "健康守门：身体相关事项不能靠记忆硬扛",
    blocks: [
      ["晨间健康记录", "08:10", "08:20", "admin", "记录睡眠、精神、需要注意的症状。"],
      ["吃药 / 补剂提醒", "08:30", "08:40", "admin", "完成后立刻标记，避免重复或漏掉。"],
      ["喝水与活动", "11:00", "11:10", "admin", "补水，站起来活动。"],
      ["拉伸恢复", "17:30", "17:50", "review", "肩颈、背部、腿部做一轮。"],
      ["晚间检查", "21:45", "22:00", "review", "记录今天状态，安排明天提醒。"],
    ],
    reviewQuestions: ["今天有没有漏掉必须做的健康事项？", "明天哪个提醒要提前？"],
  },
  {
    id: "finance",
    label: "账单",
    summary: "缴费、凭证、预算、风险",
    goal: "财务闭环：账单不靠脑子记，凭证不散落",
    blocks: [
      ["账单扫描", "10:00", "10:20", "admin", "检查待缴、自动扣款和异常金额。"],
      ["处理付款", "10:25", "10:45", "admin", "完成缴费后记录凭证位置。"],
      ["凭证归档", "10:50", "11:05", "ship", "截图、PDF 或邮件统一归档。"],
      ["预算更新", "18:30", "18:45", "review", "更新本周剩余额度。"],
    ],
    reviewQuestions: ["有没有下次会忘的付款节点？", "哪个支出需要重新评估？"],
  },
  {
    id: "social",
    label: "跟进",
    summary: "回消息、承诺、关系维护",
    goal: "关系跟进闭环：重要的人和承诺都被妥善接住",
    blocks: [
      ["消息清点", "12:20", "12:35", "admin", "只处理重要未回，不陷入无限聊天。"],
      ["关键沟通准备", "15:30", "15:50", "deep", "写清楚要问什么、要给什么。"],
      ["联系与确认", "16:00", "16:25", "ship", "发出消息或完成电话。"],
      ["承诺记录", "16:30", "16:40", "review", "把答应别人的事转成提醒。"],
    ],
    reviewQuestions: ["我答应了谁什么事？", "哪个关系需要下次主动跟进？"],
  },
  {
    id: "exercise",
    label: "运动",
    summary: "热身、训练、恢复、记录",
    goal: "运动闭环：练到位，也恢复到位",
    blocks: [
      ["热身", "17:00", "17:12", "admin", "关节活动和轻微出汗。"],
      ["主训练", "17:15", "18:00", "deep", "按今天计划训练，不临时加量。"],
      ["拉伸放松", "18:05", "18:20", "review", "记录不适和下次重量。"],
      ["补水与蛋白", "18:30", "18:40", "admin", "补水，安排晚餐。"],
    ],
    reviewQuestions: ["今天强度是否合适？", "下次训练要调整什么？"],
  },
  {
    id: "exam",
    label: "考试",
    summary: "背诵、限时、错题、模拟",
    goal: "备考闭环：把焦虑变成可重复训练",
    blocks: [
      ["考点清单", "08:40", "09:00", "deep", "列出今天必须覆盖的考点。"],
      ["背诵回忆", "09:05", "09:45", "deep", "先闭卷回忆，再查漏补缺。"],
      ["限时训练", "10:00", "10:50", "ship", "严格计时完成一组题。"],
      ["错题重做", "11:00", "11:35", "review", "只看错因，不安慰自己。"],
      ["睡前轻复盘", "21:10", "21:25", "review", "只回忆结构，不熬夜硬刷。"],
    ],
    reviewQuestions: ["哪类题还不稳定？", "明天模拟要卡哪个时间？"],
  },
  {
    id: "creator",
    label: "创作",
    summary: "选题、写作、编辑、发布",
    goal: "创作闭环：从想法到发布，而不是停在草稿",
    blocks: [
      ["选题钉住", "09:30", "09:50", "deep", "确定一个具体读者和一个承诺。"],
      ["初稿冲刺", "10:00", "11:10", "deep", "不编辑，只写完。"],
      ["结构编辑", "14:30", "15:10", "review", "删掉无用段落，补上证据。"],
      ["发布检查", "16:30", "16:50", "ship", "标题、封面、链接、格式。"],
      ["数据复盘", "21:30", "21:45", "review", "记录反馈，抽一个下次选题。"],
    ],
    reviewQuestions: ["这个内容帮谁解决了什么？", "哪个反馈值得变成下一篇？"],
  },
  {
    id: "admin",
    label: "杂务",
    summary: "邮件、文件、整理、明日",
    goal: "杂务闭环：集中处理，不让小事偷走整天",
    blocks: [
      ["收件箱清理", "11:30", "11:50", "admin", "只做归类、删除、标记。"],
      ["文件归档", "14:00", "14:25", "admin", "把散落文件放到正确位置。"],
      ["必须处理的小事", "16:00", "16:35", "ship", "一次性处理 3 个以下。"],
      ["明日准备", "21:00", "21:20", "review", "明天第一块要能直接开始。"],
    ],
    reviewQuestions: ["哪些杂务可以模板化？", "明天开机第一件事是什么？"],
  },
  {
    id: "travel",
    label: "出行",
    summary: "证件、路线、打包、备份",
    goal: "出行闭环：出门前所有风险都有提醒",
    blocks: [
      ["证件与票据", "09:00", "09:20", "admin", "身份证件、车票机票、酒店确认。"],
      ["路线和时间", "09:25", "09:45", "deep", "确认出发时间、备用路线和缓冲。"],
      ["打包检查", "20:00", "20:35", "admin", "按清单收拾，不靠临场回忆。"],
      ["充电与备份", "21:00", "21:15", "admin", "设备充电，关键资料离线保存。"],
    ],
    reviewQuestions: ["最可能忘带的是什么？", "有没有必须提前出门的风险？"],
  },
  {
    id: "habit",
    label: "习惯",
    summary: "最小行动、触发、记录、连续",
    goal: "习惯闭环：小到不会失败，稳到每天能接上",
    blocks: [
      ["最小行动", "08:20", "08:30", "ship", "只做最低版本，先不断链。"],
      ["触发提醒", "12:30", "12:35", "admin", "把提醒绑定到午饭/放学/下班后。"],
      ["第二次行动", "18:20", "18:35", "ship", "做一点增强版。"],
      ["连续记录", "21:40", "21:50", "review", "记录今天是否完成和卡点。"],
    ],
    reviewQuestions: ["今天的最小行动够小吗？", "明天触发点放在哪里最稳？"],
  },
];

export const CAPTURE_PRESETS = [
  { id: "next", label: "下个空档", mode: "slot", duration: 30 },
  { id: "15m", label: "15 分钟后", mode: "offset", offset: 15, duration: 20 },
  { id: "1h", label: "1 小时后", mode: "offset", offset: 60, duration: 25 },
  { id: "tonight", label: "今晚", mode: "time", time: "21:00", duration: 25 },
  { id: "tomorrow", label: "明早", mode: "tomorrow", time: "08:30", duration: 25 },
];

export function createTemplateDraft(templateId, selectedDate) {
  const template = CLOSED_LOOP_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return null;
  return {
    id: `template-${template.id}-${selectedDate}`,
    goal: template.goal,
    selectedDate,
    blocks: template.blocks.map(([title, start, end, type, note], index) => ({
      id: `template-${template.id}-${index + 1}`,
      title,
      start,
      end,
      type,
      note,
      priority: index + 1,
      tags: [template.label],
      selectedDate,
    })),
    reminders: [],
    reviewQuestions: template.reviewQuestions,
    carryOver: [],
    source: "template",
    createdAt: new Date().toISOString(),
  };
}

export function draftToBlocks(draft, makeId) {
  return (draft?.blocks || []).map((block, index) => ({
    id: makeId(),
    title: block.title || `AI 时间块 ${index + 1}`,
    note: block.note || "",
    start: block.start || "09:00",
    end: block.end || "10:00",
    type: block.type || "deep",
    status: "planned",
  }));
}

const WEEKDAY_INDEX = {
  一: 1,
  1: 1,
  二: 2,
  2: 2,
  三: 3,
  3: 3,
  四: 4,
  4: 4,
  五: 5,
  5: 5,
  六: 6,
  6: 6,
  日: 0,
  天: 0,
  7: 0,
};

export function parseCaptureIntent(text, options = {}) {
  const raw = String(text || "");
  const selectedDate = isISODate(options.selectedDate || "") ? options.selectedDate : todayISO();
  const todayKey = isISODate(options.todayKey || "") ? options.todayKey : todayISO();
  const preset = options.preset || CAPTURE_PRESETS[0];
  const explicitDate = extractDateFromCapture(raw, selectedDate, todayKey);
  const explicitTime = extractTimeFromCapture(raw);
  const duration = extractDurationFromCapture(raw) || preset.duration || 25;
  const targetDate =
    explicitDate || (preset.mode === "tomorrow" ? addDaysISO(selectedDate, 1) : selectedDate);
  const noteParts = ["快速记录", preset.label];
  if (explicitDate) noteParts.push(`识别到 ${targetDate}`);
  if (explicitTime != null) noteParts.push("识别到输入里的时间");
  if (duration !== (preset.duration || 25)) noteParts.push(`${duration} 分钟`);

  return {
    targetDate,
    explicitTime,
    duration,
    note: noteParts.join(" · "),
    hasExplicitDate: Boolean(explicitDate),
    hasExplicitTime: explicitTime != null,
  };
}

function extractDateFromCapture(text, selectedDate, todayKey) {
  const iso = String(text).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && isISODate(iso[1])) return iso[1];
  if (/大后天/.test(text)) return addDaysISO(todayKey, 3);
  if (/后天/.test(text)) return addDaysISO(todayKey, 2);
  if (/明天|明早|明晚/.test(text)) return addDaysISO(todayKey, 1);
  if (/今天|今晚/.test(text)) return todayKey;

  const weekday = String(text).match(/(下周|这周|本周|周|星期)([一二三四五六日天1-7])/);
  if (!weekday) return null;
  const targetDay = WEEKDAY_INDEX[weekday[2]];
  if (targetDay == null) return null;
  const base = weekday[1] === "下周" ? addDaysISO(selectedDate, 7) : selectedDate;
  const current = new Date(base);
  const currentDay = current.getDay();
  let offset = targetDay - currentDay;
  if (weekday[1] === "周" || weekday[1] === "星期") {
    if (offset < 0) offset += 7;
  } else if (weekday[1] === "下周") {
    offset = targetDay - currentDay;
  }
  return addDaysISO(base, offset);
}

function extractTimeFromCapture(text) {
  const clock = String(text).match(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const chinese = String(text).match(
    /(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|明早|明晚)?\s*(\d{1,2})\s*点\s*(半|[0-5]?\d\s*分?)?/,
  );
  if (!chinese) return null;
  let hour = Number(chinese[2]);
  const period = chinese[1] || "";
  if ((/下午|傍晚|晚上|今晚|明晚/.test(period) || (hour >= 1 && hour <= 6 && /晚/.test(text))) && hour < 12) {
    hour += 12;
  }
  if (/中午/.test(period) && hour < 11) hour += 12;
  if (hour > 23) return null;
  const minuteText = chinese[3] || "";
  const minute = minuteText.includes("半") ? 30 : Number(minuteText.match(/\d+/)?.[0] || 0);
  return hour * 60 + Math.min(59, minute);
}

function extractDurationFromCapture(text) {
  const hour = String(text).match(/(\d(?:\.\d)?)\s*(小时|h|H)/);
  if (hour) return clampCaptureDuration(Math.round(Number(hour[1]) * 60));
  const minute = String(text).match(/(\d{1,3})\s*(分钟|分|min|m)/);
  if (minute) return clampCaptureDuration(Number(minute[1]));
  return null;
}

function clampCaptureDuration(minutes) {
  if (!Number.isFinite(minutes)) return null;
  return Math.max(10, Math.min(180, Math.round(minutes / 5) * 5));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  window.requestAnimationFrame(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  });
}
