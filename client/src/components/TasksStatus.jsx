/**
 * input: 任务队列 API 数据
 * output: 简洁的任务状态展示组件
 * pos: 客户端视图层：自动任务流程的状态展示（变更需同步更新本头注释与所属目录 README）
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertCircle, Clock, Activity } from 'lucide-react';
import { listJobs } from '../api/client';

function getProgressNumbers(job) {
  const p = job?.progress || {};
  return {
    phase: p?.phase ? String(p.phase) : null,
    total: Number.isFinite(p?.total) ? Number(p.total) : null,
    done: Number.isFinite(p?.done) ? Number(p.done) : Number.isFinite(p?.processed) ? Number(p.processed) : null,
    ok: Number.isFinite(p?.ok) ? Number(p.ok) : Number.isFinite(p?.embedded) ? Number(p.embedded) : null,
    errors: Number.isFinite(p?.errors) ? Number(p.errors) : null,
  };
}

function fmtProgress(job) {
  if (!job) return null;
  const { phase, done, total, ok, errors } = getProgressNumbers(job);
  const parts = [];
  if (phase) parts.push(phase);
  if (done != null || total != null) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    parts.push(`${done ?? '—'}${total != null ? ` / ${total} (${pct}%)` : ''}`);
  }
  if (ok != null) parts.push(`完成 ${ok}`);
  if (errors) parts.push(`错误 ${errors}`);
  return parts.join(' · ');
}

const TASK_LABELS = {
  discover: '扫描文件',
  enrich: '提取信息',
  thumbs_rebuild: '生成缩略图',
  faces_scan: '人脸检测',
  faces_recluster: '人脸聚类',
  clip_enrich: '图像理解',
  clip_index: '构建索引',
  sync: '同步文件',
};

const STATUS_CONFIG = {
  running: { icon: Loader2, className: 'animate-spin text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
  queued: { icon: Clock, className: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' },
  finished: { icon: CheckCircle2, className: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
  failed: { icon: AlertCircle, className: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
  cancelled: { icon: AlertCircle, className: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' },
};

function TaskItem({ job }) {
  const type = job?.type || 'unknown';
  const status = job?.status || 'unknown';
  const label = TASK_LABELS[type] || type;
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  const Icon = config.icon;
  const progress = fmtProgress(job);

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${config.bg} ${config.border}`}>
      <Icon className={`h-5 w-5 ${config.className}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {progress && <div className="text-xs text-gray-600 truncate">{progress}</div>}
      </div>
      <div className="text-xs text-gray-500 capitalize">{status}</div>
    </div>
  );
}

function StatusSummary({ jobs }) {
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const finished = jobs.filter((j) => j.status === 'finished').length;

  if (running > 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>正在处理中... ({running} 个任务)</span>
      </div>
    );
  }

  if (queued > 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-600">
        <Clock className="h-4 w-4" />
        <span>队列中: {queued} 个任务等待</span>
      </div>
    );
  }

  if (finished > 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        <span>所有任务已完成</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <Activity className="h-4 w-4" />
      <span>系统就绪，等待文件变化...</span>
    </div>
  );
}

export function TasksStatus({ className }) {
  const { data, isLoading } = useQuery({
    queryKey: ['jobs', 'status'],
    queryFn: () => listJobs({ limit: 20 }),
    refetchInterval: 2000,
  });

  const jobs = data?.jobs || [];
  const activeJobs = jobs.filter((j) => ['running', 'queued'].includes(j.status));

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm text-gray-500 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中...</span>
      </div>
    );
  }

  // Only show if there are active jobs, otherwise minimal display
  if (activeJobs.length === 0) {
    return (
      <div className={`flex items-center justify-between ${className}`}>
        <StatusSummary jobs={jobs} />
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <StatusSummary jobs={jobs} />
      <div className="space-y-2">
        {activeJobs.map((job) => (
          <TaskItem key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
