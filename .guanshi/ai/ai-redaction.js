"use strict";

const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|auth|bearer|token|secret|password|credential|cookie|set[_-]?cookie|client[_-]?secret)([_-]|$)/i;
const SECRET_TEXT_PATTERNS = [
  {
    pattern: /sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g,
    replacement: "[redacted-secret]",
  },
  {
    pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "$1[redacted]",
  },
  {
    pattern: /("?(?:api[_-]?key|x-api-key|token|secret|password|authorization|cookie|set-cookie)"?\s*[:=]\s*["']?)[^"',;\s}]+/gi,
    replacement: "$1[redacted]",
  },
];

function redactString(value, maxLength = 12000) {
  let text = String(value || "");
  for (const item of SECRET_TEXT_PATTERNS) {
    text = text.replace(item.pattern, item.replacement);
  }
  return text.slice(0, maxLength);
}

function redactSensitiveValue(value, options = {}, depth = 0) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 8;
  const maxArrayItems = Number.isInteger(options.maxArrayItems) ? options.maxArrayItems : 200;
  const maxStringLength = Number.isInteger(options.maxStringLength) ? options.maxStringLength : 12000;

  if (typeof value === "string") return redactString(value, maxStringLength);
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (depth >= maxDepth) return "[redacted-depth-limit]";

  if (Array.isArray(value)) {
    return value.slice(0, maxArrayItems).map((item) => redactSensitiveValue(item, options, depth + 1));
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const safeKey = redactString(key, 160);
    if (SENSITIVE_KEY_PATTERN.test(safeKey)) {
      result[safeKey] = REDACTED;
    } else {
      result[safeKey] = redactSensitiveValue(child, options, depth + 1);
    }
  }
  return result;
}

module.exports = {
  REDACTED,
  redactSensitiveValue,
};
