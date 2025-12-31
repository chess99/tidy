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

  // Keep prior behavior: only show something when there are errors on the latest finished job.
  const latestFailed = jobs.find((j) => j.status === 'failed');
  if (latestFailed) {
      return (
        <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="bg-red-50/90 backdrop-blur-sm shadow-lg border border-red-100 rounded-full px-4 py-2 flex items-center gap-2 text-sm text-red-700">
                <AlertTriangle size={16} />
                <span>任务失败：{latestFailed.type}</span>
                <button onClick={() => window.location.reload()} className="ml-2 underline text-xs">重置</button>
            </div>
        </div>
      );
  }

  return null;
}

