const DEFAULT_DETAILS = {
  loading: '正在读取系统状态...',
  unknown: '状态数据不完整，请刷新重试',
  ok: '已可用，系统会自动继续处理。',
  issue: '当前不可用，请检查依赖或等待系统自动恢复。',
};

export function getCapabilityModel(capability, options = {}) {
  const { isLoading = false } = options;

  if (isLoading) {
    return {
      kind: 'loading',
      label: '检查中',
      detail: DEFAULT_DETAILS.loading,
    };
  }

  if (!capability || typeof capability !== 'object') {
    return {
      kind: 'unknown',
      label: '未知',
      detail: DEFAULT_DETAILS.unknown,
    };
  }

  const message = String(capability.message || '').trim();
  const code = String(capability.code || '').trim();

  if (capability.available === true) {
    return {
      kind: 'ok',
      label: '正常',
      detail: message || DEFAULT_DETAILS.ok,
    };
  }

  if (capability.available === false) {
    return {
      kind: 'issue',
      label: '待恢复',
      detail: message || code || DEFAULT_DETAILS.issue,
    };
  }

  return {
    kind: 'unknown',
    label: '未知',
    detail: message || code || DEFAULT_DETAILS.unknown,
  };
}
