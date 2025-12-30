import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2, X, FolderCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiUrl, getAsset, getAssetsBatch, getFilesBatch, scanPath, syncChanges, updateAssetStatus } from './api/client';
import { MinimalScanStatus } from './components/MinimalScanStatus';
import { ScanStatusSidebar } from './components/ScanStatusSidebar';
import { ConfigView } from './components/ConfigView';
import { FilesFilters } from './components/FilesFilters';
import { FilesGrid } from './components/FilesGrid';
import { AssetFacesPanel } from './components/AssetFacesPanel';
import { AssetViewer } from './components/AssetViewer';
import { Button } from './components/ui/button';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';

const queryClient = new QueryClient();

function Main() {
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('config'); // config | files | albums
  const [filesQuery, setFilesQuery] = useState(() => ({
    filter: localStorage.getItem('filesFilter') || 'all',
    exts: [],
    organized: undefined,
    hasDup: false,
    hasPeople: false,
    personCountMin: undefined,
    personCountMax: undefined,
    from: undefined,
    to: undefined,
    pathContains: '',
    hash: '',
  }));
  const qc = useQueryClient();
  const selectedAssetRef = useRef(null);
  const [detailThumbErrorHash, setDetailThumbErrorHash] = useState(null);

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

  // Track thumbnail errors per-asset without setState-in-effect (React compiler warning).

  useEffect(() => {
    try {
      localStorage.setItem('filesFilter', filesQuery.filter || 'all');
    } catch {
      // ignore
    }
  }, [filesQuery.filter]);

  // Keep query.filter in sync with the range selector (until we fully remove it from header).
  // Avoid setState in an effect (React compiler warning); update both states at the event source instead.

  // SSE incremental updates: only patch changed items into react-query cache.
  useEffect(() => {
    const saved = Number(localStorage.getItem('changesCursor') || 0);
    const es = new EventSource(apiUrl(`/changes/stream?cursor=${saved}`));

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

  const handleFilterByPerson = (personId) => {
    setActiveTab('files');
    setFilesQuery((prev) => {
      const current = prev.people ? (Array.isArray(prev.people) ? prev.people : String(prev.people).split(',').map(Number)) : [];
      if (current.includes(personId)) return prev;
      return { ...prev, people: [...current, personId] };
    });
  };

  const applyFilter = (patch) => {
    setActiveTab('files');
    setFilesQuery((prev) => ({ ...prev, ...patch }));
  };

  const dirPrefixOf = (p) => {
    if (!p) return '';
    const s = String(p);
    const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    if (idx <= 0) return s;
    return s.slice(0, idx + 1);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-xl font-bold flex items-center gap-2">
          📸 Tidy <span className="text-xs font-normal text-gray-500">v0.1</span>
        </h1>
        <div className="flex gap-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="config">配置&扫描</TabsTrigger>
              <TabsTrigger value="files">全部文件</TabsTrigger>
              <TabsTrigger value="albums">文件夹/归档</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="secondary"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw size={14} /> 同步变更
          </Button>
        </div>
      </header>

      {/* {activeTab === 'config' ? <ScanProgress /> : null} REMOVED */}
      
      <div className="flex-1 flex overflow-hidden relative">
        {/* Floating Minimal Status for non-config pages */}
        {activeTab !== 'config' && <MinimalScanStatus />}

        {activeTab === 'files' ? (
          <FilesFilters value={filesQuery} onChange={setFilesQuery} />
        ) : null}

        <div className="flex-1 relative flex flex-col min-w-0">
          {activeTab === 'config' ? (
            <div className="flex h-full">
              <div className="flex-1 overflow-y-auto">
                <ConfigView
                  onScan={() => scanMutation.mutate({})}
                  onAfterClear={() => {
                    qc.invalidateQueries({ queryKey: ['files'] });
                    qc.invalidateQueries({ queryKey: ['assets'] });
                    qc.invalidateQueries({ queryKey: ['albums'] });
                  }}
                />
              </div>
              <ScanStatusSidebar className="w-80 border-l bg-gray-50" />
            </div>
          ) : activeTab === 'files' ? (
            <FilesGrid onFileClick={handleFileClick} queryOpts={filesQuery} />
          ) : (
            <AlbumsView onAssetClick={setSelectedAsset} />
          )}
        </div>

        {selectedAsset && activeTab !== 'config' && (
          <aside className="w-96 bg-white border-l shadow-xl z-20 flex flex-col h-full">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-700">详情</h2>
              <button onClick={() => setSelectedAsset(null)} className="hover:bg-gray-200 p-1 rounded">
                <X size={18}/>
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-3 border relative">
                {/* Click-to-open viewer */}
                <button
                  type="button"
                  className="absolute inset-0 z-20 cursor-pointer"
                  onClick={() => setViewerOpen(true)}
                  title="查看原图/播放视频"
                />

                {/* Background: cover + blur */}
                <img
                  src={apiUrl(`/assets/${selectedAsset.hash}/preview?max=2048&q=80`)}
                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-70"
                  alt=""
                  aria-hidden="true"
                  onError={() => setDetailThumbErrorHash(selectedAsset.hash)}
                />
                <div className="absolute inset-0 bg-black/10" aria-hidden="true" />

                {/* Foreground: contain to show full image */}
                {detailThumbErrorHash !== selectedAsset.hash ? (
                  <img
                    key={`${selectedAsset.hash}:${selectedAsset.thumb_updated_at || selectedAsset.updated_at || 0}`}
                    src={apiUrl(`/assets/${selectedAsset.hash}/preview?max=4096&q=85`)}
                    className="absolute inset-0 w-full h-full object-contain z-10"
                    alt="preview"
                    onError={() => setDetailThumbErrorHash(selectedAsset.hash)}
                  />
                ) : (
                  String(selectedAsset.mime_type || '').toLowerCase().startsWith('video/') ? (
                    <img
                      src={apiUrl(`/assets/${selectedAsset.hash}/poster?w=1280&q=4`)}
                      className="absolute inset-0 w-full h-full object-contain z-10"
                      alt="poster"
                    />
                  ) : (
                    <div className="absolute inset-0 w-full h-full flex items-center justify-center text-sm text-gray-700 z-10">
                      无预览（点此全屏查看 / 打开原文件）
                    </div>
                  )
                )}

                {/* Action pills */}
                <div className="absolute top-3 right-3 z-30 flex items-center gap-2 pointer-events-none">
                  <a
                    className="pointer-events-auto inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-white/90 border text-xs shadow-sm hover:bg-white cursor-pointer"
                    href={apiUrl(`/assets/${selectedAsset.hash}/raw`)}
                    target="_blank"
                    rel="noreferrer"
                    title="打开/下载原文件"
                    onClick={(e) => e.stopPropagation()}
                  >
                    原文件
                  </a>
                  <button
                    type="button"
                    className="pointer-events-auto inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-black/70 text-white text-xs shadow-sm hover:bg-black/80 cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setViewerOpen(true);
                    }}
                    title="全屏查看"
                  >
                    全屏
                  </button>
                </div>
              </div>
              
              <div className="space-y-4 text-sm text-gray-600">
                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">ASSET</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1 font-semibold">Hash</div>
                    <div className="col-span-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-mono text-xs break-all text-gray-800">{selectedAsset.hash}</div>
                        <Button variant="outline" size="sm" onClick={() => applyFilter({ hash: selectedAsset.hash })}>
                          仅看
                        </Button>
                      </div>
                    </div>

                    <div className="col-span-1 font-semibold">Mime</div>
                    <div className="col-span-2">{selectedAsset.mime_type || '—'}</div>

                    <div className="col-span-1 font-semibold">Taken</div>
                    <div className="col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>{selectedAsset.taken_at ? new Date(selectedAsset.taken_at).toLocaleString() : '—'}</div>
                        {selectedAsset.taken_at ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applyFilter({ from: new Date(selectedAsset.taken_at).setHours(0, 0, 0, 0) })}
                            >
                              设为从
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applyFilter({ to: new Date(selectedAsset.taken_at).setHours(23, 59, 59, 999) })}
                            >
                              设为到
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="col-span-1 font-semibold">Size</div>
                    <div className="col-span-2">
                      {Number.isFinite(selectedAsset.size) ? `${(selectedAsset.size / 1024 / 1024).toFixed(2)} MB` : '—'}
                    </div>

                    <div className="col-span-1 font-semibold">Camera</div>
                    <div className="col-span-2">
                      {[selectedAsset.camera_make, selectedAsset.camera_model].filter(Boolean).join(' ') || '—'}
                      {selectedAsset.is_camera ? <span className="ml-2 text-xs text-blue-600">(camera)</span> : null}
                    </div>

                    <div className="col-span-1 font-semibold">Status</div>
                    <div className="col-span-2 uppercase text-xs font-bold tracking-wider">
                      <span className={`px-2 py-0.5 rounded ${
                        selectedAsset.status === 'trash' ? 'bg-red-100 text-red-700' :
                        selectedAsset.status === 'sorted' ? 'bg-green-100 text-green-700' : 'bg-gray-100'
                      }`}>
                        {selectedAsset.status}
                      </span>
                    </div>

                    <div className="col-span-1 font-semibold">Target</div>
                    <div className="col-span-2 text-xs break-all">{selectedAsset.target_path || '—'}</div>

                    <div className="col-span-1 font-semibold">Updated</div>
                    <div className="col-span-2">
                      {selectedAsset.updated_at ? new Date(selectedAsset.updated_at).toLocaleString() : '—'}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-3">
                  <AssetFacesPanel 
                    hash={selectedAsset.hash} 
                    assetUrl={apiUrl(`/assets/${selectedAsset.hash}/preview?max=4096&q=85`)}
                    originalSize={{ width: selectedAsset.metadata?.width, height: selectedAsset.metadata?.height }}
                    onFilterByPerson={handleFilterByPerson}
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-500 mb-2">FILES</div>
                  <div className="text-xs text-gray-500 mb-2">
                    共 {Array.isArray(selectedAsset.files) ? selectedAsset.files.length : 0} 份物理文件
                  </div>
                  <div className="rounded-lg border bg-white max-h-40 overflow-auto">
                    <div className="p-2 space-y-2">
                      {(selectedAsset.files || []).map((f) => (
                        <div key={f.id || f.path} className="text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-mono break-all text-gray-800">{f.path}</div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => applyFilter({ pathContains: dirPrefixOf(f.path) })}
                              title="筛选同目录"
                            >
                              同目录
                            </Button>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {Number.isFinite(f.size) ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : '—'}
                            {f.mtime_ms ? <span className="ml-2">{new Date(f.mtime_ms).toLocaleString()}</span> : null}
                          </div>
                        </div>
                      ))}
                      {(!selectedAsset.files || selectedAsset.files.length === 0) ? (
                        <div className="text-xs text-gray-500">—</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <details className="rounded-lg border bg-white">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-600">
                    METADATA (JSON)
                  </summary>
                  <pre className="p-3 text-[11px] whitespace-pre-wrap break-words text-gray-700">
{JSON.stringify(selectedAsset.metadata || {}, null, 2)}
                  </pre>
                </details>
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

      <AssetViewer
        open={viewerOpen && !!selectedAsset}
        onOpenChange={setViewerOpen}
        asset={selectedAsset}
      />
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
