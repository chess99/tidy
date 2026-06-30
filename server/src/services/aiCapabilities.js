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

async function getAiCapabilities({ aiServiceUrl = AI_SERVICE_URL } = {}) {
  const url = joinUrl(aiServiceUrl, '/health');
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return unavailableAll('ai_service_unhealthy', `AI service health returned ${res.status}`);
    }

    const json = await res.json();
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
    return unavailableAll('ai_service_unreachable', `AI service unreachable: ${err?.message || err}`);
  }
}

module.exports = { getAiCapabilities };
