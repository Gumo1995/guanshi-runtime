"use strict";

const MODEL_INPUT_BUDGET_REPORT_SCHEMA = "guanshi-ai-model-input-budget-report-v1";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_PREFERRED_INPUT_BUDGET_TOKENS = 96000;
const DEFAULT_PER_MESSAGE_CHAR_GUARD = 50000;
const DEFAULT_MESSAGE_TARGET_CHARS = 48000;
const MAX_PROVIDER_MESSAGES = 24;

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function estimateTextTokens(value) {
  const text = String(value || "");
  let cjkLike = 0;
  let ascii = 0;
  let other = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint <= 0x7f) ascii += 1;
    else if (
      (codePoint >= 0x3400 && codePoint <= 0x9fff)
      || (codePoint >= 0x3040 && codePoint <= 0x30ff)
      || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) cjkLike += 1;
    else other += 1;
  }
  return Math.max(1, Math.ceil(cjkLike + other + (ascii / 4)));
}

function resolveModelInputLimits(provider = {}, maxOutputTokens = 1400) {
  const outputReserveTokens = normalizeInteger(maxOutputTokens, 1400, 1, 32000);
  const contextWindowTokens = normalizeInteger(
    provider?.contextWindowTokens,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    8192,
    2000000,
  );
  const maximumInputTokens = Math.max(4096, contextWindowTokens - outputReserveTokens);
  const preferredDefault = Math.min(DEFAULT_PREFERRED_INPUT_BUDGET_TOKENS, maximumInputTokens);
  const inputBudgetTokens = normalizeInteger(
    provider?.preferredInputBudgetTokens,
    preferredDefault,
    4096,
    maximumInputTokens,
  );
  const perMessageCharGuard = normalizeInteger(
    provider?.perMessageCharGuard,
    DEFAULT_PER_MESSAGE_CHAR_GUARD,
    8000,
    DEFAULT_PER_MESSAGE_CHAR_GUARD,
  );
  return {
    contextWindowTokens,
    inputBudgetTokens,
    outputReserveTokens,
    perMessageCharGuard,
    messageTargetChars: Math.min(DEFAULT_MESSAGE_TARGET_CHARS, perMessageCharGuard),
    maxMessages: MAX_PROVIDER_MESSAGES,
  };
}

function splitContent(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return [];
  const limit = Math.max(1000, Number(maxChars) || DEFAULT_MESSAGE_TARGET_CHARS);
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    const minimumBreak = Math.floor(limit * 0.6);
    const newlineIndex = remaining.lastIndexOf("\n", limit);
    const breakIndex = newlineIndex >= minimumBreak ? newlineIndex : limit;
    chunks.push(remaining.slice(0, breakIndex).trim());
    remaining = remaining.slice(breakIndex).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function truncateTextToTokenBudget(value, tokenBudget) {
  const text = String(value || "").trim();
  const budget = Math.max(1, Number(tokenBudget) || 1);
  const estimatedTokens = estimateTextTokens(text);
  if (estimatedTokens <= budget) return { text, truncated: false, originalTokens: estimatedTokens };
  const ratio = Math.max(0.01, Math.min(1, budget / estimatedTokens));
  const marker = "\n\n[中间内容因模型上下文预算已省略；原文仍保留在本轮用户消息中]\n\n";
  const targetChars = Math.max(200, Math.floor(text.length * ratio) - marker.length);
  const headLength = Math.max(120, Math.floor(targetChars * 0.72));
  const tailLength = Math.max(60, targetChars - headLength);
  return {
    text: `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`,
    truncated: true,
    originalTokens: estimatedTokens,
  };
}

function normalizeSection(section, index) {
  const source = section && typeof section === "object" && !Array.isArray(section) ? section : {};
  const content = String(source.content || "").trim();
  if (!content) return null;
  return {
    key: String(source.key || `section_${index + 1}`).trim(),
    label: String(source.label || source.key || `Section ${index + 1}`).trim(),
    content,
    summary: String(source.summary || "").trim(),
    priority: normalizeInteger(source.priority, 50, 0, 100),
    required: source.required === true,
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
    itemCount: Math.max(0, Number.parseInt(String(source.itemCount || 0), 10) || 0),
  };
}

function buildSectionReport(section, content, mode, reason = "") {
  return {
    key: section.key,
    label: section.label,
    mode,
    reason,
    itemCount: section.itemCount,
    characters: String(content || "").length,
    estimatedTokens: content ? estimateTextTokens(content) : 0,
  };
}

function packSections(sections, maxChars) {
  const messages = [];
  let buffer = "";
  const flush = () => {
    if (!buffer.trim()) return;
    messages.push({ role: "user", content: buffer.trim() });
    buffer = "";
  };
  for (const section of sections.sort((left, right) => left.order - right.order)) {
    const chunks = splitContent(section.selectedContent, maxChars);
    for (const chunk of chunks) {
      if (!buffer) {
        buffer = chunk;
      } else if (buffer.length + chunk.length + 1 <= maxChars) {
        buffer = `${buffer}\n${chunk}`;
      } else {
        flush();
        buffer = chunk;
      }
    }
  }
  flush();
  return messages;
}

function composeModelInput(options = {}) {
  const stage = String(options.stage || "model").trim();
  const systemPrompt = String(options.systemPrompt || "").trim();
  const provider = options.provider && typeof options.provider === "object" ? options.provider : {};
  const limits = resolveModelInputLimits(provider, options.maxOutputTokens);
  const normalizedSections = (Array.isArray(options.sections) ? options.sections : [])
    .map(normalizeSection)
    .filter(Boolean);
  const history = (Array.isArray(options.history) ? options.history : [])
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").trim(),
    }))
    .filter((message) => message.content);

  const included = [];
  const compressed = [];
  const omitted = [];
  const systemTokens = estimateTextTokens(systemPrompt);
  let remainingTokens = Math.max(1, limits.inputBudgetTokens - systemTokens);
  const selectedSections = [];

  const selectionOrder = [...normalizedSections].sort((left, right) => {
    if (left.required !== right.required) return left.required ? -1 : 1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    return left.order - right.order;
  });

  for (const section of selectionOrder) {
    const sectionTokens = estimateTextTokens(section.content);
    if (sectionTokens <= remainingTokens) {
      section.selectedContent = section.content;
      selectedSections.push(section);
      remainingTokens -= sectionTokens;
      included.push(buildSectionReport(section, section.content, "full"));
      continue;
    }
    if (!section.required && section.summary) {
      const summaryTokens = estimateTextTokens(section.summary);
      if (summaryTokens <= remainingTokens) {
        section.selectedContent = section.summary;
        selectedSections.push(section);
        remainingTokens -= summaryTokens;
        compressed.push(buildSectionReport(section, section.summary, "summary", "input_budget"));
        continue;
      }
    }
    if (section.required && remainingTokens > 100) {
      const truncated = truncateTextToTokenBudget(section.content, remainingTokens);
      section.selectedContent = truncated.text;
      selectedSections.push(section);
      remainingTokens = Math.max(0, remainingTokens - estimateTextTokens(truncated.text));
      compressed.push(buildSectionReport(section, truncated.text, "excerpt", "input_budget"));
      continue;
    }
    omitted.push(buildSectionReport(section, "", "omitted", "input_budget"));
  }

  const selectedHistory = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const tokens = estimateTextTokens(message.content);
    if (tokens > remainingTokens) break;
    selectedHistory.unshift(message);
    remainingTokens -= tokens;
  }
  if (selectedHistory.length < history.length) {
    compressed.push({
      key: "history",
      label: "最近对话历史",
      mode: "recent_only",
      reason: "input_budget",
      itemCount: selectedHistory.length,
      omittedItemCount: history.length - selectedHistory.length,
      characters: selectedHistory.reduce((sum, message) => sum + message.content.length, 0),
      estimatedTokens: selectedHistory.reduce((sum, message) => sum + estimateTextTokens(message.content), 0),
    });
  } else if (selectedHistory.length) {
    included.push({
      key: "history",
      label: "最近对话历史",
      mode: "full",
      reason: "",
      itemCount: selectedHistory.length,
      characters: selectedHistory.reduce((sum, message) => sum + message.content.length, 0),
      estimatedTokens: selectedHistory.reduce((sum, message) => sum + estimateTextTokens(message.content), 0),
    });
  }

  let primaryMessages = packSections(selectedSections, limits.messageTargetChars);
  while (1 + selectedHistory.length + primaryMessages.length > limits.maxMessages && selectedHistory.length) {
    selectedHistory.shift();
    const includedHistoryIndex = included.findIndex((entry) => entry.key === "history");
    if (includedHistoryIndex >= 0) included.splice(includedHistoryIndex, 1);
    const historyReport = compressed.find((entry) => entry.key === "history");
    if (historyReport) {
      historyReport.itemCount = selectedHistory.length;
      historyReport.omittedItemCount = history.length - selectedHistory.length;
      historyReport.reason = "message_count";
    } else {
      compressed.push({
        key: "history",
        label: "最近对话历史",
        mode: "recent_only",
        reason: "message_count",
        itemCount: selectedHistory.length,
        omittedItemCount: history.length - selectedHistory.length,
        characters: selectedHistory.reduce((sum, message) => sum + message.content.length, 0),
        estimatedTokens: selectedHistory.reduce((sum, message) => sum + estimateTextTokens(message.content), 0),
      });
    }
  }

  if (1 + selectedHistory.length + primaryMessages.length > limits.maxMessages) {
    const optionalByPriority = [...selectedSections]
      .filter((section) => !section.required)
      .sort((left, right) => left.priority - right.priority);
    while (optionalByPriority.length && 1 + selectedHistory.length + primaryMessages.length > limits.maxMessages) {
      const removed = optionalByPriority.shift();
      const index = selectedSections.indexOf(removed);
      if (index >= 0) selectedSections.splice(index, 1);
      const includedIndex = included.findIndex((entry) => entry.key === removed.key);
      if (includedIndex >= 0) included.splice(includedIndex, 1);
      const compressedIndex = compressed.findIndex((entry) => entry.key === removed.key);
      if (compressedIndex >= 0) compressed.splice(compressedIndex, 1);
      omitted.push(buildSectionReport(removed, "", "omitted", "message_count"));
      primaryMessages = packSections(selectedSections, limits.messageTargetChars);
    }
  }

  if (1 + selectedHistory.length + primaryMessages.length > limits.maxMessages) {
    primaryMessages = primaryMessages.slice(-(limits.maxMessages - 1 - selectedHistory.length));
    compressed.push({
      key: "required_sections",
      label: "必需输入",
      mode: "tail_messages_only",
      reason: "message_count",
      itemCount: primaryMessages.length,
      characters: primaryMessages.reduce((sum, message) => sum + message.content.length, 0),
      estimatedTokens: primaryMessages.reduce((sum, message) => sum + estimateTextTokens(message.content), 0),
    });
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...selectedHistory,
    ...primaryMessages,
  ];
  const characters = messages.reduce((sum, message) => sum + message.content.length, 0);
  const estimatedTokens = messages.reduce((sum, message) => sum + estimateTextTokens(message.content), 0);
  return {
    messages,
    report: {
      schema: MODEL_INPUT_BUDGET_REPORT_SCHEMA,
      stage,
      providerId: String(provider?.id || "").trim(),
      model: String(provider?.model || "").trim(),
      limits,
      usage: {
        messageCount: messages.length,
        characters,
        estimatedTokens,
        inputBudgetUtilization: Math.min(1, estimatedTokens / limits.inputBudgetTokens),
      },
      included,
      compressed,
      omitted,
    },
  };
}

module.exports = {
  MODEL_INPUT_BUDGET_REPORT_SCHEMA,
  composeModelInput,
  estimateTextTokens,
  resolveModelInputLimits,
};
