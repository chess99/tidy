import { useQuery } from '@tanstack/react-query';
import { Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { getScanStatus } from '../api/client';

export function MinimalScanStatus() {
  const { data } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: getScanStatus,
    refetchInterval: 1000,
  });

  if (!data) return null;

  const { isScanning, stats } = data;

  // Only show if scanning or if recently finished (stats present)
  // For "Minimal", maybe we only show when scanning, or a subtle "Done" indicator.
  // The user said "simple status display... simple and beautiful".

  if (isScanning) {
    const walked = stats?.walked || 0;
    const scanned = stats?.scanned || 0;
    const total = stats?.total || 0;
    const pendingHash = Math.max(0, walked - scanned);

    return (
      <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
        <div className="bg-white/90 backdrop-blur-sm shadow-lg border rounded-full pl-3 pr-4 py-2 flex items-center gap-3 text-sm">
          <RefreshCw className="text-blue-500 animate-spin" size={16} />
          <div className="flex flex-col text-xs leading-none gap-0.5">
            <span className="font-semibold text-gray-700">正在扫描...</span>
            <span className="text-gray-500">
                {scanned} / {walked} (Pending: {pendingHash})
            </span>
          </div>
          {total > 0 && (
             <div className="h-8 w-[1px] bg-gray-200 mx-1"></div>
          )}
          {total > 0 && (
             <div className="text-xs text-gray-500">
                Found: {total}
             </div>
          )}
        </div>
      </div>
    );
  }

  // Show a brief "Done" state? Or nothing?
  // Let's show nothing if idle, to be "clean". 
  // Unless there are errors.
  if (stats?.errors > 0) {
      return (
        <div className="absolute top-4 right-4 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="bg-red-50/90 backdrop-blur-sm shadow-lg border border-red-100 rounded-full px-4 py-2 flex items-center gap-2 text-sm text-red-700">
                <AlertTriangle size={16} />
                <span>扫描完成，有 {stats.errors} 个错误</span>
                <button onClick={() => window.location.reload()} className="ml-2 underline text-xs">重置</button>
            </div>
        </div>
      );
  }

  return null;
}

