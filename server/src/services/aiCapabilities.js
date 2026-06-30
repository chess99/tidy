/**
 * input: AI service health endpoint
 * output: normalized AI capability state for job preflight and UI status
 * pos: server service boundary for AI availability checks
 */

const { AI_SERVICE_URL } = require('../config');

function joinUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!b) return path;
  return path.startsWith('/') ? `${b}${path}` : `${b}/${path}`;
}

function normalizeCapability(raw, fallbackCode, fallbackMessage) {
  const available = raw?.available === true;
  return {
    available,
    code: available ? null : String(raw?.code || fallbackCode),
    message: String(raw?.message || fallbackMessage),
  };
}

function unavailableAll(code, message) {
  return {
    ok: false,
    service: 'tidy-ai-service',
    faces: { available: false, code, message },
    clip: { available: false, code, message },
    checkedAt: Date.now(),
  };
}

function unhealthyMessage(json) {
  const detail = json?.message || json?.error || json?.status || '';
  return detail
    ? `AI service health reported ok=false: ${detail}`
    : 'AI service health reported ok=false';
}

function timeoutMessage(timeoutMs) {
  return `AI service health timed out after ${timeoutMs}ms`;
}

async function getAiCapabilities({ aiServiceUrl = AI_SERVICE_URL, timeoutMs = 3000 } = {}) {
  const url = joinUrl(aiServiceUrl, '/health');
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return unavailableAll('ai_service_unhealthy', `AI service health returned ${res.status}`);
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      return unavailableAll(
        'ai_service_invalid_response',
        `AI service health returned invalid JSON: ${err?.message || err}`
      );
    }

    if (json?.ok === false) {
      return unavailableAll('ai_service_unhealthy', unhealthyMessage(json));
    }

    const caps = json?.capabilities || {};
    return {
      ok: true,
      service: String(json?.service || 'tidy-ai-service'),
      faces: normalizeCapability(
        caps.faces,
        'faces_capability_missing',
        'Face recognition capability is not reported by AI service'
      ),
      clip: normalizeCapability(
        caps.clip,
        'clip_capability_missing',
        'CLIP capability is not reported by AI service'
      ),
      checkedAt: Date.now(),
    };
  } catch (err) {
    if (timedOut || err?.name === 'AbortError') {
      return unavailableAll('ai_service_timeout', timeoutMessage(timeoutMs));
    }
    return unavailableAll('ai_service_unreachable', `AI service unreachable: ${err?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { getAiCapabilities };
