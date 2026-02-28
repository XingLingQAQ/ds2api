'use strict';

const {
  resetIncrementalToolState,
  noteText,
  insideCodeFence,
} = require('./state');
const {
  parseStandaloneToolCallsDetailed,
} = require('./parse');
const {
  extractJSONObjectFrom,
} = require('./jsonscan');

function processToolSieveChunk(state, chunk, toolNames) {
  if (!state) {
    return [];
  }
  if (chunk) {
    state.pending += chunk;
  }
  const events = [];

  if (Array.isArray(state.pendingToolCalls) && state.pendingToolCalls.length > 0) {
    const pending = state.pending || '';
    if (pending.trim() !== '') {
      const content = (state.pendingToolRaw || '') + pending;
      state.pending = '';
      state.pendingToolRaw = '';
      state.pendingToolCalls = [];
      noteText(state, content);
      events.push({ type: 'text', text: content });
    } else {
      return events;
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (state.capturing) {
      if (state.pending) {
        state.capture += state.pending;
        state.pending = '';
      }
      const consumed = consumeToolCapture(state, toolNames);
      if (!consumed.ready) {
        break;
      }
      const captured = state.capture;
      state.capture = '';
      state.capturing = false;
      resetIncrementalToolState(state);

      if (Array.isArray(consumed.calls) && consumed.calls.length > 0) {
        state.pendingToolRaw = captured;
        state.pendingToolCalls = consumed.calls;
        continue;
      }
      if (consumed.prefix) {
        noteText(state, consumed.prefix);
        events.push({ type: 'text', text: consumed.prefix });
      }
      if (consumed.suffix) {
        state.pending += consumed.suffix;
      }
      continue;
    }

    const pending = state.pending || '';
    if (!pending) {
      break;
    }

    const start = findToolSegmentStart(pending);
    if (start >= 0) {
      const prefix = pending.slice(0, start);
      if (prefix) {
        noteText(state, prefix);
        events.push({ type: 'text', text: prefix });
      }
      state.pending = '';
      state.capture += pending.slice(start);
      state.capturing = true;
      resetIncrementalToolState(state);
      continue;
    }

    const [safe, hold] = splitSafeContentForToolDetection(pending);
    if (!safe) {
      break;
    }
    state.pending = hold;
    noteText(state, safe);
    events.push({ type: 'text', text: safe });
  }
  return events;
}

function flushToolSieve(state, toolNames) {
  if (!state) {
    return [];
  }
  const events = processToolSieveChunk(state, '', toolNames);

  if (Array.isArray(state.pendingToolCalls) && state.pendingToolCalls.length > 0) {
    events.push({ type: 'tool_calls', calls: state.pendingToolCalls });
    state.pendingToolRaw = '';
    state.pendingToolCalls = [];
  }

  if (state.capturing) {
    const consumed = consumeToolCapture(state, toolNames);
    if (consumed.ready) {
      if (consumed.prefix) {
        noteText(state, consumed.prefix);
        events.push({ type: 'text', text: consumed.prefix });
      }
      if (Array.isArray(consumed.calls) && consumed.calls.length > 0) {
        events.push({ type: 'tool_calls', calls: consumed.calls });
      }
      if (consumed.suffix) {
        noteText(state, consumed.suffix);
        events.push({ type: 'text', text: consumed.suffix });
      }
    } else if (state.capture) {
      noteText(state, state.capture);
      events.push({ type: 'text', text: state.capture });
    }
    state.capture = '';
    state.capturing = false;
    resetIncrementalToolState(state);
  }

  if (state.pending) {
    noteText(state, state.pending);
    events.push({ type: 'text', text: state.pending });
    state.pending = '';
  }

  return events;
}

function splitSafeContentForToolDetection(s) {
  const text = s || '';
  if (!text) {
    return ['', ''];
  }
  const suspiciousStart = findSuspiciousPrefixStart(text);
  if (suspiciousStart < 0) {
    return [text, ''];
  }
  if (suspiciousStart > 0) {
    return [text.slice(0, suspiciousStart), text.slice(suspiciousStart)];
  }
  // If suspicious content starts at the beginning, keep holding until we can
  // either parse a full tool JSON block or reach stream flush.
  return ['', text];
}

function findSuspiciousPrefixStart(s) {
  let start = -1;
  for (const needle of ['{', '[', '```']) {
    const idx = s.lastIndexOf(needle);
    if (idx > start) {
      start = idx;
    }
  }
  return start;
}

function findToolSegmentStart(s) {
  if (!s) {
    return -1;
  }
  const lower = s.toLowerCase();
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const keyIdx = lower.indexOf('tool_calls', offset);
    if (keyIdx < 0) {
      return -1;
    }
    const start = s.slice(0, keyIdx).lastIndexOf('{');
    const candidateStart = start >= 0 ? start : keyIdx;
    if (!insideCodeFence(s.slice(0, candidateStart))) {
      return candidateStart;
    }
    offset = keyIdx + 'tool_calls'.length;
  }
}

function consumeToolCapture(state, toolNames) {
  const captured = state.capture || '';
  if (!captured) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }
  const lower = captured.toLowerCase();
  const keyIdx = lower.indexOf('tool_calls');
  if (keyIdx < 0) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }
  const start = captured.slice(0, keyIdx).lastIndexOf('{');
  if (start < 0) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }
  const obj = extractJSONObjectFrom(captured, start);
  if (!obj.ok) {
    return { ready: false, prefix: '', calls: [], suffix: '' };
  }

  const prefixPart = captured.slice(0, start);
  const suffixPart = captured.slice(obj.end);

  if (insideCodeFence((state.recentTextTail || '') + prefixPart)) {
    return {
      ready: true,
      prefix: captured,
      calls: [],
      suffix: '',
    };
  }

  if ((state.recentTextTail || '').trim() !== '' || prefixPart.trim() !== '' || suffixPart.trim() !== '') {
    return {
      ready: true,
      prefix: captured,
      calls: [],
      suffix: '',
    };
  }

  const parsed = parseStandaloneToolCallsDetailed(captured.slice(start, obj.end), toolNames);
  if (!Array.isArray(parsed.calls) || parsed.calls.length === 0) {
    if (parsed.sawToolCallSyntax && parsed.rejectedByPolicy) {
      return {
        ready: true,
        prefix: prefixPart,
        calls: [],
        suffix: suffixPart,
      };
    }
    return {
      ready: true,
      prefix: captured,
      calls: [],
      suffix: '',
    };
  }

  return {
    ready: true,
    prefix: prefixPart,
    calls: parsed.calls,
    suffix: suffixPart,
  };
}

module.exports = {
  processToolSieveChunk,
  flushToolSieve,
};
