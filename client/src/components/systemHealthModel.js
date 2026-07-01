const DEFAULT_DETAILS = {
  loading: '正在读取系统状态...',
  unknown: '状态数据不完整，请刷新重试',
  ok: '已可用，系统会自动继续处理。',
  issue: '当前不可用，请检查依赖或等待系统自动恢复。',
};

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function getProgressText(progress) {
  if (!progress || typeof progress !== 'object') return '';
  const done = asFiniteNumber(progress.done);
  const processed = asFiniteNumber(progress.processed);
  const completed = done != null ? done : processed;
  const total = asFiniteNumber(progress.total);
  if (completed != null && total != null && total > 0) {
    return `${completed} / ${total}`;
  }
  if (completed != null) {
    return `${completed}`;
  }
  return '';
}

function isFacesUnavailableTask(task) {
  const lastError = asTrimmedString(task?.last_error).toLowerCase();
  const blockedReason = asTrimmedString(task?.progress?.blockedReason).toLowerCase();
  return lastError.includes('faces_unavailable') || blockedReason === 'faces_unavailable';
}

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

  const message = asTrimmedString(capability.message);
  const code = asTrimmedString(capability.code);

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

export function getWatcherSummaryModel(watcher) {
  if (!watcher || typeof watcher !== 'object') {
    return {
      kind: 'unknown',
      label: '未知',
      detail: '文件监听状态暂不可用。',
    };
  }

  if (watcher.mode === 'off' || watcher.state === 'disabled') {
    return {
      kind: 'unknown',
      label: '已关闭',
      detail: '文件监听已关闭，可通过手动扫描更新图库。',
    };
  }

  if (watcher.state === 'watching') {
    const count = Array.isArray(watcher.activeRoots) ? watcher.activeRoots.length : 0;
    return {
      kind: 'ok',
      label: '实时监听',
      detail: `正在监听 ${count} 个本地目录。`,
    };
  }

  if (watcher.state === 'fallback') {
    const hasNetworkRoot = Array.isArray(watcher.roots)
      ? watcher.roots.some((root) => root?.reason === 'network_drive' || root?.reason === 'unc_path')
      : false;
    return {
      kind: 'unknown',
      label: '降级扫描',
      detail: hasNetworkRoot
        ? '网络盘已关闭实时监听，系统会定期补扫。'
        : '当前目录不适合实时监听，系统会定期补扫。',
    };
  }

  if (watcher.state === 'error') {
    return {
      kind: 'issue',
      label: '监听异常',
      detail: asTrimmedString(watcher.lastError) || '文件监听遇到异常。',
    };
  }

  return {
    kind: 'unknown',
    label: '检查中',
    detail: '正在判断目录监听方式。',
  };
}

export function getTaskSummaryModel(taskState, options = {}) {
  const { capabilityKey } = options;
  const latest = taskState?.latest;
  const lookupError = asTrimmedString(taskState?.error);

  if (lookupError) {
    return {
      tone: 'neutral',
      text: '最近任务：状态读取失败',
    };
  }

  if (!latest || typeof latest !== 'object') {
    return {
      tone: 'neutral',
      text: '暂无最近任务',
    };
  }

  const status = asTrimmedString(latest.status).toLowerCase();
  const progressText = getProgressText(latest.progress);

  if (status === 'running') {
    return {
      tone: 'running',
      text: `最近任务：处理中${progressText ? ` ${progressText}` : ''}`,
    };
  }

  if (status === 'queued') {
    return {
      tone: 'running',
      text: '最近任务：排队中',
    };
  }

  if (status === 'finished') {
    return {
      tone: 'ok',
      text: '最近任务：已完成',
    };
  }

  if (status === 'failed' || status === 'interrupted') {
    if (capabilityKey === 'faces' && isFacesUnavailableTask(latest)) {
      return {
        tone: 'issue',
        text: '最近任务：人脸能力不可用，系统会在恢复后自动重试',
      };
    }

    return {
      tone: 'issue',
      text: status === 'interrupted' ? '最近任务：已中断' : '最近任务：失败',
    };
  }

  return {
    tone: 'neutral',
    text: `最近任务：${status || '状态未知'}`,
  };
}
