/**
 * input: React + Query + API client
 * output: 应用根组件（视图编排与全局交互）
 * pos: 客户端根节点：承载主要视图与操作入口（变更需同步更新本头注释与所属目录 README）
 */

import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, X, FolderCheck, Briefcase, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiUrl, getAsset, getAssetsBatch, getFilesUnified, getFilesBatch, updateAssetStatus, openFileLocation } from './api/client';
import { MinimalScanStatus } from './components/MinimalScanStatus';
import { FilesFilters } from './components/FilesFilters';
import { FilesFiltersSimple } from './components/FilesFiltersSimple';
import { FilesGrid } from './components/FilesGrid';
import { AssetDetail } from './components/AssetDetail';
import { AlbumsView } from './components/AlbumsView';
import { TrashView } from './components/TrashView';
import { DuplicatesToolView } from './components/DuplicatesToolView';
import { AssetFacesPanel } from './components/AssetFacesPanel';
import { AssetViewer } from './components/AssetViewer';
import { Button } from './components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { GRID_COLUMNS } from './utils/gridLayout';
import { useFilesGridController } from './hooks/useFilesGridController';
import { SystemAdminView } from './components/SystemAdminView';

const queryClient = new QueryClient();
const DEFAULT_SIMILAR_THRESHOLD = 10;

// Component to handle video poster loading with error message
function PosterImageWithError({ hash }) {
  const [error, setError] = useState(false);
  const posterUrl = apiUrl(`/assets/${hash}/poster?w=1280&q=4`);
  
  if (error) {
    return (
      <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center text-sm text-gray-700 z-10 bg-gray-50/50">
        <div className="text-center px-4">
          <div className="font-medium mb-1">无法生成视频缩略图</div>
          <div className="text-xs text-gray-600 mt-2">
            需要安装 ffmpeg 才能生成视频缩略图
          </div>
          <div className="text-xs text-gray-500 mt-1">
            macOS: <span className="font-mono">brew install ffmpeg</span>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <img
      src={posterUrl}
      className="absolute inset-0 w-full h-full object-contain z-10"
      alt="poster"
      onError={() => setError(true)}
    />
  );
}

function Main() {
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('files'); // files | albums | trash | admin | duplicates
  const [lastMainTab, setLastMainTab] = useState('files');
  const [albumsViewerNav, setAlbumsViewerNav] = useState(() => ({ onPrev: undefined, onNext: undefined }));
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
    similarKind: null, // 'phash' | null
    similarToFileId: null, // number | null (seed file_id)
    similarThreshold: DEFAULT_SIMILAR_THRESHOLD, // 0..32
    similarTopK: 500, // clip only
    similarMinScore: 0.25, // clip only (cosine similarity)
    smartQuery: '',
    smartTopK: 1000,
    smartMinScore: 0.25,
  }));
  const qc = useQueryClient();
  const selectedAssetRef = useRef(null);
  const [detailThumbErrorHash, setDetailThumbErrorHash] = useState(null);
  const filesGridRef = useRef(null);

  const LIMIT = 50;
  const COLUMNS = GRID_COLUMNS;

  const filesCtrl = useFilesGridController({
    active: activeTab === 'files',
    viewerOpen,
    filesQuery,
    columns: COLUMNS,
    limit: LIMIT,
    filesGridRef,
    getFiles: getFilesUnified,
    getAsset,
    setSelectedAsset,
  });

  const setActiveTabSafe = (nextTab) => {
    setActiveTab(nextTab);
    if (['files', 'albums', 'trash'].includes(nextTab)) {
      setLastMainTab(nextTab);
    }
    if (nextTab !== 'files') {
      filesCtrl.reset();
    }
    if (nextTab !== 'albums') {
      setAlbumsViewerNav({ onPrev: undefined, onNext: undefined });
    }
  };

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

        // Deletions are represented by "missing from batch response".
        // Since patchInfinite only merges, we must invalidate to drop deleted items from cached pages.
        if (fileIds.length) {
          const got = Array.isArray(filesRes?.data) ? filesRes.data : [];
          if (got.length < fileIds.length) qc.invalidateQueries({ queryKey: ['files'] });
        }
        if (assetHashes.length) {
          const got = Array.isArray(assetsRes?.data) ? assetsRes.data : [];
          if (got.length < assetHashes.length) qc.invalidateQueries({ queryKey: ['assets'] });
        }

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

  const handleFilterByPerson = (personId) => {
    setActiveTabSafe('files');
    setFilesQuery((prev) => {
      const current = prev.people ? (Array.isArray(prev.people) ? prev.people : String(prev.people).split(',').map(Number)) : [];
      if (current.includes(personId)) return prev;
      return { ...prev, people: [...current, personId] };
    });
  };

  const applyFilter = (patch) => {
    setActiveTabSafe('files');
    setFilesQuery((prev) => ({ ...prev, ...patch }));
  };

  const pickSimilarSeedFileId = (asset) => {
    const files = Array.isArray(asset?.files) ? asset.files : [];
    for (const f of files) {
      if (f?.phash_status !== 'done') continue;
      if (!f?.phash) continue;
      const id = Number(f.id);
      if (Number.isFinite(id)) return id;
    }
    return null;
  };

  const applySimilarPhash = (asset) => {
    const seedFileId = pickSimilarSeedFileId(asset);
    if (!Number.isFinite(seedFileId)) return;
    setActiveTabSafe('files');
    setFilesQuery((prev) => ({
      ...prev,
      similarKind: 'phash',
      similarToFileId: seedFileId,
      similarThreshold: Number.isFinite(Number(prev?.similarThreshold))
        ? Math.max(0, Math.min(32, Math.floor(Number(prev.similarThreshold))))
        : DEFAULT_SIMILAR_THRESHOLD,
      // Similar search and hash-exact are mutually exclusive in practice.
      hash: '',
    }));
  };

  const pickClipSeedFileId = (asset) => {
    const files = Array.isArray(asset?.files) ? asset.files : [];
    for (const f of files) {
      const id = Number(f?.id);
      if (Number.isFinite(id)) return id;
    }
    return null;
  };

  const applySimilarClip = (asset) => {
    const seedFileId = pickClipSeedFileId(asset);
    if (!Number.isFinite(seedFileId)) return;
    setActiveTabSafe('files');
    setFilesQuery((prev) => ({
      ...prev,
      smartQuery: '',
      similarKind: 'clip',
      similarToFileId: seedFileId,
      similarTopK: Number.isFinite(Number(prev?.similarTopK)) ? Math.max(1, Math.min(5000, Math.floor(Number(prev.similarTopK)))) : 500,
      similarMinScore: Number.isFinite(Number(prev?.similarMinScore)) ? Number(prev.similarMinScore) : 0.25,
      hash: '',
    }));
  };

  const dirPrefixOf = (p) => {
    if (!p) return '';
    const s = String(p);
    const idx = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    if (idx <= 0) return s;
    return s.slice(0, idx + 1);
  };

  const detailTypeLabel = (() => {
    try {
      const extFrom = (raw) => {
        if (!raw) return '';
        const s = String(raw).trim().toLowerCase().replace(/^\./, '');
        return s;
      };

      // Prefer album asset list fields (so Albums tab is consistent without extra API calls).
      const sampleExt = extFrom(selectedAsset?.sample_ext);
      if (sampleExt) return sampleExt.toUpperCase();
      const samplePath = selectedAsset?.sample_path;
      const sampleFromPath = samplePath ? extFrom(String(samplePath).split('.').pop()) : '';
      if (sampleFromPath) return sampleFromPath.toUpperCase();

      // Otherwise, pick a representative file from asset.files (best-effort).
      const files = Array.isArray(selectedAsset?.files) ? selectedAsset.files : [];
      let best = null;
      let bestScore = -Infinity;
      for (const f of files) {
        const t = Number(
          f?.mtime_ms ??
          f?.updated_at ??
          f?.discovered_at ??
          f?.scanned_at ??
          0
        );
        const score = (Number.isFinite(t) ? t : 0) * 10 + (Number.isFinite(Number(f?.id)) ? Number(f.id) : 0);
        if (!best || score > bestScore) {
          best = f;
          bestScore = score;
        }
      }

      const extRaw = best?.ext || (best?.path ? String(best.path).split('.').pop() : null);
      const ext = extFrom(extRaw);
      if (ext) return ext.toUpperCase();
      const mt = String(selectedAsset?.mime_type || '').toLowerCase();
      if (mt.startsWith('video/')) return 'VIDEO';
      if (mt.startsWith('image/')) return 'IMAGE';
      return null;
    } catch {
      return null;
    }
  })();

  const similarSeedFileId = pickSimilarSeedFileId(selectedAsset);
  const canFindSimilar = Number.isFinite(similarSeedFileId);
  const canFindSimilarClip =
    String(selectedAsset?.mime_type || '').toLowerCase().startsWith('image/') && Number.isFinite(pickClipSeedFileId(selectedAsset));

  const goHome = () => {
    setActiveTabSafe('files');
    setSelectedAsset(null);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm z-10">
        <button
          type="button"
          onClick={goHome}
          className="text-xl font-bold flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
          title="回到首页"
        >
          <img src="/icon.png" className="w-8 h-8 rounded-md shadow-sm" alt="Tidy" />
          <span>Tidy</span>
        </button>
        <div className="flex items-center gap-2">
          {activeTab !== 'admin' && activeTab !== 'duplicates' ? (
            <>
              <Tabs value={activeTab} onValueChange={setActiveTabSafe}>
                <TabsList>
                  <TabsTrigger value="files">全部文件</TabsTrigger>
                  <TabsTrigger value="albums">文件夹/归档</TabsTrigger>
                  <TabsTrigger value="trash">回收站</TabsTrigger>
                </TabsList>
              </Tabs>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="icon" title="实用工具">
                    <Briefcase className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-3">
                  <div className="text-sm font-semibold text-gray-900">实用工具</div>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      className="w-full text-left rounded-lg border bg-white hover:bg-gray-50 p-3 transition"
                      onClick={() => {
                        setActiveTabSafe('duplicates');
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-gray-800">
                          <Copy className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900">检查重复项</div>
                          <div className="text-xs text-gray-600 mt-1 leading-5">
                            按 hash + 图片相似度分组，逐组保留/删除副本（全选同 hash 可升级为删除 asset）。
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              <Button variant="outline" onClick={() => setActiveTabSafe('admin')}>
                系统管理
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setActiveTabSafe(lastMainTab || 'files')}>
              返回
            </Button>
          )}
        </div>
      </header>

      {/* {activeTab === 'config' ? <ScanProgress /> : null} REMOVED */}
      
      <div className="flex-1 flex overflow-hidden relative">
        {/* Floating Minimal Status for non-task pages */}
        {activeTab !== 'admin' && <MinimalScanStatus />}

        {activeTab === 'files' ? (
          <FilesFilters value={filesQuery} onChange={setFilesQuery} />
        ) : null}

        <div className="flex-1 relative flex flex-col min-w-0">
          {activeTab === 'admin' ? (
            <SystemAdminView />
          ) : activeTab === 'duplicates' ? (
            <DuplicatesToolView
              onAssetClick={(asset) => {
                setSelectedAsset(asset);
                filesCtrl.reset();
              }}
            />
          ) : activeTab === 'trash' ? (
            <TrashView
              onAssetClick={(asset) => {
                setSelectedAsset(asset);
                filesCtrl.reset();
              }}
            />
          ) : activeTab === 'files' ? (
            <FilesGrid
              ref={filesGridRef}
              queryOpts={filesQuery}
              cursorFileId={filesCtrl.cursorFileId}
              brushHint={filesCtrl.brushHint}
              onMetaChange={filesCtrl.onMetaChange}
              onFileClick={filesCtrl.onFileClick}
            />
          ) : (
            <AlbumsView
              viewerOpen={viewerOpen}
              onViewerNavChange={setAlbumsViewerNav}
              onAssetClick={(asset) => {
                setSelectedAsset(asset);
                filesCtrl.reset();
              }}
            />
          )}
        </div>

        {selectedAsset && activeTab !== 'admin' && (
          <AssetDetail
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            onOpenViewer={() => setViewerOpen(true)}
            onApplyFilter={applyFilter}
            onApplySimilarPhash={applySimilarPhash}
            onApplySimilarClip={applySimilarClip}
            onStatusChange={handleStatusChange}
            onFilterByPerson={handleFilterByPerson}
          />
        )}

      </div>

      <AssetViewer
        open={viewerOpen && !!selectedAsset}
        onOpenChange={setViewerOpen}
        asset={selectedAsset}
        onPrev={activeTab === 'files' ? filesCtrl.viewerPrev : (activeTab === 'albums' ? albumsViewerNav.onPrev : undefined)}
        onNext={activeTab === 'files' ? filesCtrl.viewerNext : (activeTab === 'albums' ? albumsViewerNav.onNext : undefined)}
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
