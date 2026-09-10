/**
 * input: AI service health endpoint
 * output: normalized AI capability state for job preflight and UI status
 * pos: server service boundary for AI availability checks
 */

const path = require('path');
const { AI_SERVICE_URL, CLIP_MODEL_ID } = require('../config');

function joinUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!b) return path;
  return path.startsWith('/') ? `${b}${path}` : `${b}/${path}`;
}

function normalizeCapability(raw, fallbackCode, fallbackMessage) {
  const available = raw?.available === true;
  const capability = {
    available,
    code: available ? null : String(raw?.code || fallbackCode),
    message: String(raw?.message || fallbackMessage),
  };
  if (raw?.model) capability.model = String(raw.model);
  return capability;
}

function normalizeModelId(modelId) {
  const value = String(modelId || '').trim();
  if (!value) return '';
  if (!path.isAbsolute(value)) return value;
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validateClipModel(capability) {
  if (!capability.available) return capability;
  const actual = normalizeModelId(capability.model);
  const expected = normalizeModelId(CLIP_MODEL_ID);
  if (!actual) {
    return {
      available: false,
      code: 'clip_model_missing',
      message: `AI service did not report its CLIP model; expected ${CLIP_MODEL_ID}`,
    };
  }
  if (actual !== expected) {
    return {
      available: false,
      code: 'clip_model_mismatch',
      message: `CLIP model mismatch: server expects ${CLIP_MODEL_ID}, AI service reports ${capability.model}`,
      model: capability.model,
    };
  }
  return capability;
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

function normalizeTimeoutMs(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 3000;
  return n;
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

async function getAiCapabilities({ aiServiceUrl = AI_SERVICE_URL, timeoutMs = 3000 } = {}) {
  const url = joinUrl(aiServiceUrl, '/health');
  const effectiveTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const controller = new AbortController();
  let timeout;

  const timeoutResult = new Promise((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(unavailableAll('ai_service_timeout', timeoutMessage(effectiveTimeoutMs)));
    }, effectiveTimeoutMs);
  });

  const operation = async () => {
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        return unavailableAll('ai_service_unhealthy', `AI service health returned ${res.status}`);
      }

      let json;
      try {
        json = await res.json();
      } catch (err) {
        if (controller.signal.aborted && isAbortError(err)) {
          return unavailableAll('ai_service_timeout', timeoutMessage(effectiveTimeoutMs));
        }
        return unavailableAll(
          'ai_service_invalid_response',
          `AI service health returned invalid JSON: ${err?.message || err}`
        );
      }

      if (json?.ok === false) {
        return unavailableAll('ai_service_unhealthy', unhealthyMessage(json));
      }

      const caps = json?.capabilities || {};
      const clip = validateClipModel(normalizeCapability(
        caps.clip,
        'clip_capability_missing',
        'CLIP capability is not reported by AI service'
      ));
      return {
        ok: true,
        service: String(json?.service || 'tidy-ai-service'),
        faces: normalizeCapability(
          caps.faces,
          'faces_capability_missing',
          'Face recognition capability is not reported by AI service'
        ),
        clip,
        checkedAt: Date.now(),
      };
    } catch (err) {
      if (controller.signal.aborted && isAbortError(err)) {
        return unavailableAll('ai_service_timeout', timeoutMessage(effectiveTimeoutMs));
      }
      return unavailableAll('ai_service_unreachable', `AI service unreachable: ${err?.message || err}`);
    }
  };

  try {
    return await Promise.race([operation(), timeoutResult]);
  } finally {
    clearTimeout(timeout);
    // Ensure an already-started request does not keep doing work after caller receives timeout.
    controller.abort();
  }
}

module.exports = { getAiCapabilities };
