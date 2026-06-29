/**
 * input: job queue data + optional navigation callback
 * output: compact header task status chip with detail popover
 * pos: client view layer global task status entry
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock3, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { listJobs } from '../api/client';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const STATUS_COPY = {
  running: '处理中',
  queued: '等待中',
  failed: '任务失败',
  interrupted: '任务中断',
};

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function getJobProgress(job) {
  const processed = finiteNumber(job?.progress?.processed);
  const total = finiteNumber(job?.progress?.total);
  const hasTotal = total != null && total > 0;
  const percent = hasTotal && processed != null
    ? Math.max(0, Math.min(100, Math.round((processed / total) * 100)))
    : null;

  return {
    processed,
    total: hasTotal ? total : null,
    percent,
    text: percent != null
      ? `${percent}%`
      : processed != null || hasTotal
        ? `${processed ?? '-'}${hasTotal ? ` / ${total}` : ''}`
        : '',
  };
}

function TaskIcon({ status }) {
  if (status === 'running') {
    return <RefreshCw className="h-4 w-4 animate-spin" />;
  }
  if (status === 'queued') {
    return <Clock3 className="h-4 w-4" />;
  }
  return <AlertTriangle className="h-4 w-4" />;
}

function TaskSummaryRow({ job }) {
  const progress = getJobProgress(job);
  return (
    <div className="rounded-md border bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-900">
            {STATUS_COPY[job.status] || job.status}
          </div>
          <div className="mt-0.5 truncate text-xs text-gray-500">
            {job.type} · {job.mode}
          </div>
        </div>
        {progress.text ? (
          <div className="shrink-0 text-xs tabular-nums text-gray-600">{progress.text}</div>
        ) : null}
      </div>
      {progress.percent != null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress.percent}%` }} />
        </div>
      ) : null}
      {job.last_error ? (
        <div className="mt-2 truncate text-xs text-red-700" title={String(job.last_error)}>
          {String(job.last_error)}
        </div>
      ) : null}
    </div>
  );
}

export function MinimalScanStatus({ onOpenTasks }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['jobs', 'minimal'],
    queryFn: () => listJobs({ limit: 50 }),
    refetchInterval: 1000,
  });

  const model = useMemo(() => {
    const jobs = data?.data || [];
    const running = jobs.filter((j) => j.status === 'running');
    const queued = jobs.filter((j) => j.status === 'queued');
    const active = [...running, ...queued];
    if (active.length > 0) {
      const primary = active[0];
      return {
        visible: true,
        status: running.length > 0 ? 'running' : 'queued',
        primary,
        jobs: active,
      };
    }

    const latest = jobs[0] || null;
    if (latest && (latest.status === 'failed' || latest.status === 'interrupted')) {
      return {
        visible: true,
        status: latest.status,
        primary: latest,
        jobs: [latest],
      };
    }

    return { visible: false, status: null, primary: null, jobs: [] };
  }, [data?.data]);

  if (!model.visible) return null;

  const progress = getJobProgress(model.primary);
  const hasMultiple = model.jobs.length > 1;
  const isProblem = model.status === 'failed' || model.status === 'interrupted';
  const label = hasMultiple
    ? `${model.jobs.length} 项${model.status === 'queued' ? '等待中' : '处理中'}`
    : STATUS_COPY[model.status] || '任务';
  const title = `${label}${model.primary?.type ? ` · ${model.primary.type} · ${model.primary.mode}` : ''}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={clsx(
            'relative inline-flex h-9 max-w-[180px] items-center gap-2 overflow-hidden rounded-md border px-3 text-sm font-medium shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.98]',
            isProblem
              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              : model.status === 'queued'
                ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
          )}
          title={title}
        >
          <TaskIcon status={model.status} />
          <span className="hidden sm:inline truncate">{label}</span>
          {progress.text ? (
            <span className="shrink-0 text-xs tabular-nums opacity-80">{progress.text}</span>
          ) : null}
          {progress.percent != null && !isProblem ? (
            <span
              className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500"
              style={{ width: `${progress.percent}%` }}
              aria-hidden="true"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {isProblem ? STATUS_COPY[model.status] : '正在处理任务'}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {hasMultiple ? `${model.jobs.length} 个任务` : `${model.primary.type} · ${model.primary.mode}`}
            </div>
          </div>
          <div
            className={clsx(
              'rounded-full p-2',
              isProblem ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
            )}
          >
            <TaskIcon status={model.status} />
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {model.jobs.slice(0, 4).map((job) => (
            <TaskSummaryRow key={job.id} job={job} />
          ))}
        </div>

        {model.jobs.length > 4 ? (
          <div className="mt-2 text-xs text-gray-500">还有 {model.jobs.length - 4} 个任务</div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => {
            setOpen(false);
            onOpenTasks?.();
          }}
        >
          查看任务队列
        </Button>
      </PopoverContent>
    </Popover>
  );
}
