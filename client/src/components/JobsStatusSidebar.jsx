/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle, Loader2, RefreshCw, X } from 'lucide-react';
import { cancelJob, listJobs, retryJob } from '../api/client';

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function StatusChip({ status }) {
  const s = String(status || '');
  const cls =
    s === 'running'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : s === 'queued'
        ? 'bg-gray-50 text-gray-700 border-gray-200'
        : s === 'finished'
          ? 'bg-green-50 text-green-700 border-green-200'
          : s === 'failed'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] border ${cls}`}>{s || '—'}</span>;
}

export function JobsStatusSidebar({ className }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['jobs', 'sidebar'],
    queryFn: () => listJobs({ limit: 50 }),
    refetchInterval: 1000,
  });

  const jobs = data?.data || [];
  const running = jobs.find((j) => j.status === 'running');
  const queued = jobs.find((j) => j.status === 'queued');
  const active = running || queued;

  const cancelMutation = useMutation({
    mutationFn: (id) => cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const retryMutation = useMutation({
    mutationFn: (id) => retryJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <aside className={`w-80 bg-gray-50/80 backdrop-blur-sm border-l flex flex-col h-full overflow-hidden ${className || ''}`}>
      <div className="p-5 border-b bg-white/50">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
          <Activity size={18} className="text-blue-600" />
          任务状态
        </h2>
        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${running ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          {running ? '正在后台处理任务…' : (queued ? '任务排队中…' : '系统空闲')}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 border shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-gray-500">当前任务</div>
              <div className="mt-1 font-semibold text-gray-900">{active ? `${active.type} · ${active.mode}` : '—'}</div>
              <div className="mt-1 text-[11px] text-gray-500">{active ? fmtTs(active.started_at || active.created_at) : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              {active ? <StatusChip status={active.status} /> : null}
              {running ? <RefreshCw className="text-blue-600 animate-spin" size={16} /> : <CheckCircle className="text-green-500" size={16} />}
            </div>
          </div>

          {active?.progress?.phase ? (
            <div className="mt-4 text-xs text-gray-600 break-all">
              Phase: <span className="font-mono">{String(active.progress.phase)}</span>
            </div>
          ) : null}
          {(Number.isFinite(active?.progress?.processed) || Number.isFinite(active?.progress?.total)) ? (
            <div className="mt-2 text-xs text-gray-600 tabular-nums">
              {Number.isFinite(active?.progress?.processed) ? active.progress.processed : '—'}
              {Number.isFinite(active?.progress?.total) ? ` / ${active.progress.total}` : ''}
            </div>
          ) : null}
          {active?.last_error ? (
            <div className="mt-3 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 break-all">
              {String(active.last_error)}
            </div>
          ) : null}

          {active && (active.status === 'running' || active.status === 'queued') ? (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  const ok = window.confirm(`取消任务？\n${active.type} · ${active.mode}`);
                  if (!ok) return;
                  cancelMutation.mutate(active.id);
                }}
              >
                <X size={14} />
                取消
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">最近任务</div>
          <div className="space-y-2">
            {jobs.slice(0, 10).map((j) => (
              <div key={j.id} className="bg-white p-3 rounded-xl border shadow-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{j.type} · {j.mode}</div>
                  <div className="text-[11px] text-gray-500">{fmtTs(j.created_at)}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {j.status === 'running' ? <Loader2 size={14} className="animate-spin text-blue-600" /> : null}
                  <StatusChip status={j.status} />
                  {j.status === 'failed' || j.status === 'interrupted' ? (
                    <button
                      type="button"
                      className="text-[11px] text-blue-700 hover:underline"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(j.id)}
                      title="以相同参数重新创建一个任务"
                    >
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {jobs.length === 0 ? (
              <div className="text-sm text-gray-500 px-1">暂无任务</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-4 border-t bg-gray-50 text-[10px] text-gray-400 text-center">
        Tidy Jobs
      </div>
    </aside>
  );
}


