'use strict';

const {
  toStringSafe,
  looksLikeToolExampleContext,
} = require('./state');
const {
  stripFencedCodeBlocks,
  buildToolCallCandidates,
  parseToolCallsPayload,
} = require('./parse_payload');

function extractToolNames(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }
  const out = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') {
      continue;
    }
    const fn = t.function && typeof t.function === 'object' ? t.function : t;
    const name = toStringSafe(fn.name);
    // Keep parity with Go injectToolPrompt: object tools without name still
    // enter tool mode via fallback name "unknown".
    out.push(name || 'unknown');
  }
  return out;
}

function parseToolCalls(text, toolNames) {
  return parseToolCallsDetailed(text, toolNames).calls;
}

function parseToolCallsDetailed(text, toolNames) {
  const result = emptyParseResult();
  if (!toStringSafe(text)) {
    return result;
  }
  const sanitized = stripFencedCodeBlocks(text);
  if (!toStringSafe(sanitized)) {
    return result;
  }
  result.sawToolCallSyntax = sanitized.toLowerCase().includes('tool_calls');

  const candidates = buildToolCallCandidates(sanitized);
  let parsed = [];
  for (const c of candidates) {
    parsed = parseToolCallsPayload(c);
    if (parsed.length > 0) {
      result.sawToolCallSyntax = true;
      break;
    }
  }
  if (parsed.length === 0) {
    return result;
  }

  const filtered = filterToolCallsDetailed(parsed, toolNames);
  result.calls = filtered.calls;
  result.rejectedToolNames = filtered.rejectedToolNames;
  result.rejectedByPolicy = filtered.rejectedToolNames.length > 0 && filtered.calls.length === 0;
  return result;
}

function parseStandaloneToolCalls(text, toolNames) {
  return parseStandaloneToolCallsDetailed(text, toolNames).calls;
}

function parseStandaloneToolCallsDetailed(text, toolNames) {
  const result = emptyParseResult();
  const trimmed = toStringSafe(text);
  if (!trimmed) {
    return result;
  }
  if (looksLikeToolExampleContext(trimmed)) {
    return result;
  }
  result.sawToolCallSyntax = trimmed.toLowerCase().includes('tool_calls');
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return result;
  }

  const parsed = parseToolCallsPayload(trimmed);
  if (parsed.length === 0) {
    return result;
  }

  result.sawToolCallSyntax = true;
  const filtered = filterToolCallsDetailed(parsed, toolNames);
  result.calls = filtered.calls;
  result.rejectedToolNames = filtered.rejectedToolNames;
  result.rejectedByPolicy = filtered.rejectedToolNames.length > 0 && filtered.calls.length === 0;
  return result;
}

function emptyParseResult() {
  return {
    calls: [],
    sawToolCallSyntax: false,
    rejectedByPolicy: false,
    rejectedToolNames: [],
  };
}

function filterToolCallsDetailed(parsed, toolNames) {
  const sourceNames = Array.isArray(toolNames) ? toolNames : [];
  const allowed = new Set();
  const allowedCanonical = new Map();
  for (const item of sourceNames) {
    const name = toStringSafe(item);
    if (!name) {
      continue;
    }
    allowed.add(name);
    const lower = name.toLowerCase();
    if (!allowedCanonical.has(lower)) {
      allowedCanonical.set(lower, name);
    }
  }

  if (allowed.size === 0) {
    const rejected = [];
    const seen = new Set();
    for (const tc of parsed) {
      if (!tc || !tc.name) {
        continue;
      }
      if (seen.has(tc.name)) {
        continue;
      }
      seen.add(tc.name);
      rejected.push(tc.name);
    }
    return { calls: [], rejectedToolNames: rejected };
  }

  const calls = [];
  const rejected = [];
  const seenRejected = new Set();
  for (const tc of parsed) {
    if (!tc || !tc.name) {
      continue;
    }
    let matchedName = '';
    if (allowed.has(tc.name)) {
      matchedName = tc.name;
    } else {
      matchedName = allowedCanonical.get(tc.name.toLowerCase()) || '';
    }
    if (!matchedName) {
      if (!seenRejected.has(tc.name)) {
        seenRejected.add(tc.name);
        rejected.push(tc.name);
      }
      continue;
    }
    calls.push({
      name: matchedName,
      input: tc.input && typeof tc.input === 'object' && !Array.isArray(tc.input) ? tc.input : {},
    });
  }
  return { calls, rejectedToolNames: rejected };
}

module.exports = {
  extractToolNames,
  parseToolCalls,
  parseToolCallsDetailed,
  parseStandaloneToolCalls,
  parseStandaloneToolCallsDetailed,
};
