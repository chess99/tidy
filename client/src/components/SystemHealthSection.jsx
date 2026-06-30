/**
 * input: system status API data + query state
 * output: compact AI capability health card for simplified settings
 * pos: client view layer settings subsection for automatic recovery visibility
 */

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, CircleHelp, Loader2, RefreshCw, ScanFace, Search } from 'lucide-react';
import { getSystemStatus } from '../api/client';
import { getCapabilityModel } from './systemHealthModel';
import { Button } from './ui/button';

const STATUS_META = {
  loading: {
    icon: Loader2,
    iconClassName: 'text-gray-500 animate-spin',
    badgeClassName: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  unknown: {
    icon: CircleHelp,
    iconClassName: 'text-gray-500',
    badgeClassName: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  ok: {
    icon: CheckCircle2,
    iconClassName: 'text-green-600',
    badgeClassName: 'bg-green-50 text-green-700 border-green-200',
  },
  issue: {
    icon: AlertCircle,
    iconClassName: 'text-amber-600',
    badgeClassName: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

function HealthRow({ title, icon: Icon, capability, isLoading = false }) {
  const model = getCapabilityModel(capability, { isLoading });
  const meta = STATUS_META[model.kind];
  const StatusIcon = meta.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-600">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-gray-900">{title}</div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${meta.badgeClassName}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${meta.iconClassName}`} />
            {model.label}
          </span>
        </div>
        <div className="mt-1 break-words text-xs text-gray-500">{model.detail}</div>
      </div>
    </div>
  );
}

export function SystemHealthSection() {
  const query = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 30_000,
  });

  const status = query.data;
  const isBusy = query.isLoading || query.isFetching;
  const isInitialLoading = query.isLoading && !status;
  const FooterIcon = query.isError ? AlertCircle : isBusy ? Loader2 : CheckCircle2;
  const footerIconClassName = query.isError ? 'text-red-500' : isBusy ? 'animate-spin' : '';
  const footerMessage = query.isError
    ? '状态获取失败，可手动刷新重试'
    : query.isFetching
      ? '正在更新状态...'
      : '系统会自动恢复可修复的问题';

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-gray-900">系统健康</div>
          <p className="mt-1 text-sm text-gray-500">自动检查人脸识别和智能搜索能力，异常时提示排查方向。</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-gray-500"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          title="刷新状态"
          aria-label="刷新状态"
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {query.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-4 w-4" />
              暂时无法读取系统状态
            </div>
            <div className="mt-1 break-words text-xs text-red-600">
              {String(query.error?.response?.data?.error || query.error?.message || '请稍后重试，或检查后端服务是否正常。')}
            </div>
          </div>
        ) : (
          <>
            <HealthRow title="人脸识别" icon={ScanFace} capability={status?.ai?.faces} isLoading={isInitialLoading} />
            <HealthRow title="智能搜索 / CLIP" icon={Search} capability={status?.ai?.clip} isLoading={isInitialLoading} />
          </>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <FooterIcon className={`h-3.5 w-3.5 ${footerIconClassName}`.trim()} />
        <span>{footerMessage}</span>
      </div>
    </section>
  );
}
