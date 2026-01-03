/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { listJobs } from '../api/client';

export function MinimalScanStatus() {
  const { data } = useQuery({
    queryKey: ['jobs', 'minimal'],
    queryFn: () => listJobs({ limit: 50 }),
    refetchInterval: 1000,
  });

  const jobs = data?.data || [];
  const running = jobs.find((j) => j.status === 'running');
  const queued = jobs.find((j) => j.status === 'queued');
  const active = running || queued;

  if (running) {
    const processed = Number.isFinite(active?.progress?.processed) ? active.progress.processed : null;
    const total = Number.isFinite(active?.progress?.total) ? active.progress.total : null;

    return (
      <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="bg-white/90 backdrop-blur-sm shadow-lg border rounded-full pl-3 pr-4 py-2 flex items-center gap-3 text-sm">
          <RefreshCw className="text-blue-500 animate-spin" size={16} />
          <div className="flex flex-col text-xs leading-none gap-0.5">
            <span className="font-semibold text-gray-700">正在处理任务…</span>
            <span className="text-gray-500">{active.type} · {active.mode}</span>
          </div>
          {total != null && total > 0 ? (
             <div className="h-8 w-[1px] bg-gray-200 mx-1"></div>
          ) : null}
          {processed != null || total != null ? (
             <div className="text-xs text-gray-500">
               {processed ?? '—'}{total != null ? ` / ${total}` : ''}
             </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Align with TasksView semantics: only show failure when the latest job (by id) is failed/interrupted.
  const latest = jobs[0] || null;
  if (latest && (latest.status === 'failed' || latest.status === 'interrupted')) {
      const errText = latest?.last_error ? String(latest.last_error) : null;
      return (
        <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="bg-red-50/90 backdrop-blur-sm shadow-lg border border-red-100 rounded-full px-4 py-2 flex items-center gap-2 text-sm text-red-700">
                <AlertTriangle size={16} />
                <span>任务失败：</span>
                <span className="font-mono">{latest.type}</span>
                {errText ? (
                  <span className="text-[11px] text-red-700/80 max-w-[260px] truncate" title={errText}>
                    · {errText}
                  </span>
                ) : null}
                <button onClick={() => window.location.reload()} className="ml-2 underline text-xs" title="刷新页面">
                  刷新
                </button>
            </div>
        </div>
      );
  }

  return null;
}

