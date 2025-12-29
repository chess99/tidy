import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, CheckCircle, Clock, Database, FileText, HardDrive, Hash, Image as ImageIcon, Layers, Loader2, RefreshCw } from 'lucide-react';
import { getScanStatus } from '../api/client';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

function StatusCard({ title, value, icon: Icon, color = "text-gray-600", subValue, subLabel }) {
  return (
    <div className="bg-white p-3 rounded-xl border shadow-sm flex items-center justify-between group hover:shadow-md transition-shadow">
      <div>
        <div className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">{title}</div>
        <div className="text-xl font-bold text-gray-800 tabular-nums">{value}</div>
        {subValue && (
          <div className="text-[10px] text-gray-400 mt-0.5">
            {subLabel}: {subValue}
          </div>
        )}
      </div>
      <div className={`p-2 rounded-lg bg-opacity-10 ${color.replace('text-', 'bg-')}`}>
        <Icon className={color} size={20} />
      </div>
    </div>
  );
}

export function ScanStatusSidebar({ className }) {
  const { data } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: getScanStatus,
    refetchInterval: 1000,
  });

  if (!data) return (
    <div className={`w-80 bg-gray-50/50 border-l p-6 flex flex-col items-center justify-center text-gray-400 ${className}`}>
      <Loader2 className="animate-spin mb-2" />
      <span className="text-sm">Connecting...</span>
    </div>
  );

  const { isScanning, stats, currentRoot } = data;
  const total = stats?.total || 0;
  const walked = stats?.walked || 0;
  const scanned = stats?.scanned || 0;
  const pendingHash = Math.max(0, walked - scanned);
  
  // Progress calculation
  // Note: 'total' might increase as we walk, so progress is approximate during walking phase
  const walkProgress = total > 0 ? Math.min(100, (walked / total) * 100) : 0;
  // If we are hashing, the "progress" is harder to define strictly if we don't know final count, 
  // but we can use walked vs scanned if walking is done.
  const hashProgress = walked > 0 ? (scanned / walked) * 100 : 0;

  return (
    <aside className={`w-80 bg-gray-50/80 backdrop-blur-sm border-l flex flex-col h-full overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-5 border-b bg-white/50">
        <h2 className="font-bold text-gray-800 flex items-center gap-2">
          <Activity size={18} className="text-blue-600" />
          系统状态
        </h2>
        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            {isScanning ? '正在后台处理任务...' : '系统空闲'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        
        {/* Main Status Indicator */}
        <div className="bg-white rounded-2xl p-5 border shadow-sm relative overflow-hidden">
          {isScanning && (
            <div className="absolute top-0 left-0 w-full h-1 bg-gray-100">
               <div className="h-full bg-blue-500 animate-progress-indeterminate"></div>
            </div>
          )}
          
          <div className="flex flex-col items-center py-4">
             <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-4 transition-colors duration-500 ${isScanning ? 'bg-blue-50' : 'bg-gray-50'}`}>
                {isScanning ? (
                    <RefreshCw className="text-blue-600 animate-spin" size={32} />
                ) : (
                    <CheckCircle className="text-green-500" size={32} />
                )}
             </div>
             <h3 className="text-lg font-bold text-gray-800">
                {isScanning ? '正在扫描' : '准备就绪'}
             </h3>
             <p className="text-xs text-gray-500 text-center mt-1 px-4 break-all">
                {isScanning ? (currentRoot || 'Initializing...') : '等待新的任务队列'}
             </p>
          </div>

          {isScanning && (
             <div className="space-y-3 mt-2">
                <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>文件发现进度 (Walk)</span>
                        <span>{walked} / {total > 0 ? total : '?'}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: `${walkProgress}%` }} />
                    </div>
                </div>
                <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>指纹计算进度 (Hash)</span>
                        <span>{scanned} / {walked}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 transition-all duration-300" style={{ width: `${hashProgress}%` }} />
                    </div>
                </div>
             </div>
          )}
        </div>

        {/* Stats Grid */}
        <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">当前会话统计</h4>
            <div className="grid grid-cols-2 gap-3">
                <StatusCard 
                    title="新增资源" 
                    value={stats?.new || 0} 
                    icon={ImageIcon} 
                    color="text-green-600" 
                />
                <StatusCard 
                    title="待处理" 
                    value={pendingHash} 
                    icon={Clock} 
                    color="text-indigo-500"
                    subLabel="Walked"
                    subValue={walked} 
                />
                <StatusCard 
                    title="已忽略" 
                    value={stats?.ignored || 0} 
                    icon={Hash} 
                    color="text-gray-400"
                    subLabel="Skipped"
                    subValue={stats?.skipped || 0}
                />
                <StatusCard 
                    title="异常" 
                    value={stats?.errors || 0} 
                    icon={AlertCircle} 
                    color="text-red-500" 
                />
            </div>
        </div>

        {/* Queue Info (if available) */}
        {(Number.isFinite(data.queueTotal) && data.queueTotal > 0) && (
             <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <div className="flex items-center gap-2 mb-2">
                    <Layers size={16} className="text-blue-600"/>
                    <span className="font-semibold text-blue-900 text-sm">扫描队列</span>
                </div>
                <div className="flex items-center justify-between text-xs text-blue-700">
                    <span>已完成目录: {data.queueDone}</span>
                    <span>总目录: {data.queueTotal}</span>
                </div>
                <div className="mt-2 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-blue-600 transition-all duration-500" 
                        style={{ width: `${(data.queueDone / data.queueTotal) * 100}%`}}
                    />
                </div>
             </div>
        )}

      </div>

      <div className="p-4 border-t bg-gray-50 text-[10px] text-gray-400 text-center">
        Tidy Asset Manager System
      </div>
    </aside>
  );
}

