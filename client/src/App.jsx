import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, FolderCheck, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { getAsset, getAssetsBatch, getFilesBatch, getScanStatus, scanPath, syncChanges, updateAssetStatus } from './api/client';
import { FilesGrid } from './components/FilesGrid';
import { VirtualGrid } from './components/VirtualGrid';

const queryClient = new QueryClient();

function ScanProgress() {
  const { data } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: getScanStatus,
    refetchInterval: 1000, 
  });

  if (!data) return null;

  if (data.isScanning) {
    const walked = data.stats.walked || 0;
    const scanned = data.stats.scanned || 0;
    const pendingHash = Math.max(0, walked - scanned);
    return (
      <div className="bg-blue-50 px-4 py-2 text-sm flex gap-4 items-center border-b border-blue-100">
        <Loader2 className="animate-spin text-blue-600" size={16} />
        <span className="font-semibold text-blue-800">扫描中...</span>
        {data.stats.total > 0 && (
          <span className="text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full text-xs">
             总数: {data.stats.total}
          </span>
        )}
        <div className="flex gap-4 text-blue-600 text-xs">
          <span>walked: {walked}</span>
          <span className="text-indigo-700">已哈希: {scanned}</span>
          <span className="text-indigo-500">待哈希: {pendingHash}</span>
          <span className="text-green-600">新增内容: {data.stats.new}</span>
          <span className="text-gray-500">未变化跳过: {data.stats.skipped}</span>
          <span className="text-gray-500">非图片: {data.stats.ignored}</span>
          {data.stats.errors > 0 ? <span className="text-red-600">错误: {data.stats.errors}</span> : null}
        </div>
      </div>
    );
  } else if (data.stats && data.stats.scanned > 0) {
     const walked = data.stats.walked || 0;
     const scanned = data.stats.scanned || 0;
     const pendingHash = Math.max(0, walked - scanned);
     return (
      <div className="bg-green-50 px-4 py-2 text-sm flex gap-4 items-center border-b border-green-100 justify-between">
        <div className="flex gap-4 items-center">
          <CheckCircle className="text-green-600" size={16} />
          <span className="font-semibold text-green-800">扫描完成</span>
          <div className="flex gap-4 text-green-700 text-xs">
             <span>总数: {data.stats.total}</span>
             <span>walked: {walked}</span>
             <span>已哈希: {scanned}</span>
             <span>待哈希: {pendingHash}</span>
             <span>新增内容: {data.stats.new}</span>
             <span>未变化跳过: {data.stats.skipped}</span>
             <span>非图片: {data.stats.ignored}</span>
             {data.stats.errors > 0 ? <span className="text-red-700">错误: {data.stats.errors}</span> : null}
          </div>
          {data.stats.walked !== data.stats.total && (
              <div className="flex items-center gap-1 text-orange-600 text-xs font-bold">
                  <AlertTriangle size={12}/> 数量不一致
              </div>
          )}
        </div>
        <button onClick={() => window.location.reload()} className="text-green-600 hover:underline text-xs">关闭</button>
      </div>
    );
  }

  return null;
}

function Main() {
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [activeTab, setActiveTab] = useState('files'); // files | assets
  const [pathInput, setPathInput] = useState('D:\\Photos'); // Default example
  const [filesFilter, setFilesFilter] = useState(() => localStorage.getItem('filesFilter') || 'all'); // all | media | camera
  const qc = useQueryClient();
  const selectedAssetRef = useRef(null);

  const scanMutation = useMutation({
    mutationFn: scanPath,
    onSuccess: () => {
      // Trigger polling effectively by invalidating (though polling is set in ScanProgress)
      qc.invalidateQueries(['scanStatus']);
    }
  });

  const syncMutation = useMutation({
    mutationFn: syncChanges,
    onSuccess: (data) => {
      alert(`Sync Complete!\nMoved: ${data.moved}\nDeleted: ${data.deleted}`);
      qc.invalidateQueries(['assets']);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ hash, status }) => updateAssetStatus(hash, status),
    onSuccess: () => {
      qc.invalidateQueries(['assets']);
      setSelectedAsset(prev => prev ? { ...prev, status: updateStatusMutation.variables.status } : null);
    }
  });

  const handleStatusChange = (status) => {
    if (!selectedAsset) return;
    updateStatusMutation.mutate({ hash: selectedAsset.hash, status });
  };

  useEffect(() => {
    selectedAssetRef.current = selectedAsset;
  }, [selectedAsset]);

  useEffect(() => {
    try {
      localStorage.setItem('filesFilter', filesFilter);
    } catch {
      // ignore
    }
  }, [filesFilter]);

  // SSE incremental updates: only patch changed items into react-query cache.
  useEffect(() => {
    const saved = Number(localStorage.getItem('changesCursor') || 0);
    const es = new EventSource(`http://localhost:3001/api/changes/stream?cursor=${saved}`);

    let pendingFileIds = new Set();
    let pendingAssetHashes = new Set();
    let flushTimer = null;

    const patchInfinite = (queryKey, idField, updates) => {
      if (!updates || updates.length === 0) return;
      const map = new Map(updates.map((u) => [u[idField], u]));
      qc.setQueriesData({ queryKey }, (old) => {
        if (!old || !old.pages) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            data: p.data.map((item) => (map.has(item[idField]) ? { ...item, ...map.get(item[idField]) } : item)),
          })),
        };
      });
    };

    const flush = async () => {
      flushTimer = null;

      const fileIds = Array.from(pendingFileIds).slice(0, 200);
      const assetHashes = Array.from(pendingAssetHashes).slice(0, 200);
      fileIds.forEach((id) => pendingFileIds.delete(id));
      assetHashes.forEach((h) => pendingAssetHashes.delete(h));

      try {
        const [filesRes, assetsRes] = await Promise.all([
          fileIds.length ? getFilesBatch(fileIds) : Promise.resolve({ data: [] }),
          assetHashes.length ? getAssetsBatch(assetHashes) : Promise.resolve({ data: [] }),
        ]);

        patchInfinite(['files'], 'id', filesRes.data || []);
        patchInfinite(['assets'], 'hash', assetsRes.data || []);

        const sel = selectedAssetRef.current;
        if (sel && assetsRes.data) {
          const upd = assetsRes.data.find((a) => a.hash === sel.hash);
          if (upd) setSelectedAsset((prev) => ({ ...prev, ...upd }));
        }
      } catch {
        // ignore transient errors
      }

      if (pendingFileIds.size || pendingAssetHashes.size) {
        flushTimer = setTimeout(flush, 250);
      }
    };

    const schedule = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 250);
    };

    es.addEventListener('ready', (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload && Number.isFinite(payload.cursor)) {
          localStorage.setItem('changesCursor', String(payload.cursor));
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('changes', (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload && Number.isFinite(payload.cursor)) {
          localStorage.setItem('changesCursor', String(payload.cursor));
        }
        (payload.files || []).forEach((id) => pendingFileIds.add(id));
        (payload.assets || []).forEach((h) => pendingAssetHashes.add(h));
        schedule();
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      // Let browser auto-reconnect; no-op.
    };

    return () => {
      try {
        es.close();
      } catch {
        // ignore
      }
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [qc]);

  const handleFileClick = async (file) => {
    if (!file?.hash) return;
    try {
      const asset = await getAsset(file.hash);
      setSelectedAsset(asset);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-xl font-bold flex items-center gap-2">
          📸 Tidy <span className="text-xs font-normal text-gray-500">v0.1</span>
        </h1>
        <div className="flex gap-2">
          <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded p-1">
            <button
              onClick={() => setActiveTab('files')}
              className={`px-3 py-1 rounded text-sm ${activeTab === 'files' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              全部文件
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              className={`px-3 py-1 rounded text-sm ${activeTab === 'assets' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              图库
            </button>
          </div>
          {activeTab === 'files' ? (
            <div className="flex items-center gap-2">
              <select
                value={filesFilter}
                onChange={(e) => setFilesFilter(e.target.value)}
                className="border rounded px-2 py-1 text-sm bg-white"
                title="筛选"
              >
                <option value="all">全部文件</option>
                <option value="media">全部图片/视频</option>
                <option value="camera">相机照片/视频</option>
              </select>
            </div>
          ) : null}
          <input 
            type="text" 
            value={pathInput} 
            onChange={e => setPathInput(e.target.value)} 
            placeholder="要扫描的目录（服务器路径）..."
            className="border rounded px-3 py-1 w-80 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button 
            onClick={() => scanMutation.mutate(pathInput)}
            disabled={scanMutation.isPending}
            className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {scanMutation.isPending ? '启动中...' : '扫描'}
          </button>
          <div className="w-px bg-gray-300 mx-2"></div>
          <button 
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="bg-gray-100 text-gray-700 border border-gray-300 px-4 py-1 rounded hover:bg-gray-200 flex items-center gap-2 text-sm font-medium"
          >
            <RefreshCw size={14}/> 同步变更
          </button>
        </div>
      </header>

      <ScanProgress />
      
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {activeTab === 'files' ? (
            <FilesGrid onFileClick={handleFileClick} filter={filesFilter} />
          ) : (
            <VirtualGrid onAssetClick={setSelectedAsset} />
          )}
        </div>

        {selectedAsset && (
          <aside className="w-96 bg-white border-l shadow-xl z-20 flex flex-col h-full">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-700">详情</h2>
              <button onClick={() => setSelectedAsset(null)} className="hover:bg-gray-200 p-1 rounded">
                <X size={18}/>
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-4 border">
                <img 
                  src={`http://localhost:3001/api/assets/${selectedAsset.hash}/thumb?v=${selectedAsset.thumb_updated_at || selectedAsset.updated_at || 0}`} 
                  className="w-full h-full object-contain" 
                  alt="preview"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              
              <div className="space-y-3 text-sm text-gray-600">
                <div className="grid grid-cols-3 gap-2">
                   <div className="col-span-1 font-semibold">Date</div>
                   <div className="col-span-2">{new Date(selectedAsset.taken_at).toLocaleString()}</div>
                   
                   <div className="col-span-1 font-semibold">Size</div>
                   <div className="col-span-2">{(selectedAsset.size / 1024 / 1024).toFixed(2)} MB</div>

                   <div className="col-span-1 font-semibold">Status</div>
                   <div className="col-span-2 uppercase text-xs font-bold tracking-wider">
                     <span className={`px-2 py-0.5 rounded ${
                       selectedAsset.status === 'trash' ? 'bg-red-100 text-red-700' : 
                       selectedAsset.status === 'sorted' ? 'bg-green-100 text-green-700' : 'bg-gray-100'
                     }`}>
                       {selectedAsset.status}
                     </span>
                   </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="font-bold mb-3 text-gray-700">操作</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleStatusChange('trash')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                      selectedAsset.status === 'trash' 
                        ? 'bg-red-600 text-white shadow-inner' 
                        : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    <Trash2 size={18} /> 删除
                  </button>
                  <button 
                    onClick={() => handleStatusChange('sorted')}
                    className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                      selectedAsset.status === 'sorted' 
                        ? 'bg-green-600 text-white shadow-inner' 
                        : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'
                    }`}
                  >
                    <FolderCheck size={18} /> 保留
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Main />
    </QueryClientProvider>
  );
}
