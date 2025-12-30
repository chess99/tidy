import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Trash2, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addScanRoot,
  clearLibraryByRoot,
  getConfig,
  getScanStatus,
  rebuildThumbs,
  removeScanRoot,
  reclusterFaces,
  resetFaceScanMarker,
  scanFaces,
  setScanRootEnabled,
  setScanType,
} from '../api/client';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { Switch } from './ui/switch';

function isWindowsLike() {
  try {
    const p = String(navigator?.platform || '').toLowerCase();
    const ua = String(navigator?.userAgent || '').toLowerCase();
    return p.includes('win') || ua.includes('windows');
  } catch {
    return false;
  }
}

function normExt(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('.')) s = s.slice(1);
  if (!s) return null;
  if (!/^[a-z0-9]{1,12}$/.test(s)) return null;
  return s;
}

const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff',
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'rw2', 'orf', 'sr2', 'pef',
];
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'];

// .ts can be TypeScript or MPEG Transport Stream.
// Since this is a media organizer, we default to treating it as "not media" to avoid scanning codebases.
// Users can manually add 'ts' if they have video transport streams.
const OTHER_MEDIA_EXTS = ['ts', 'mts', 'm2ts']; 

const COMMON_EXTS = ['jpg', 'heic', 'png', 'webp', 'gif', 'mp4', 'mov', 'dng'];

function uniq(arr) {
  return Array.from(new Set(arr));
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
        {Number.isFinite(value) ? value : (value ?? '—')}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-gray-500 leading-4">{hint}</div> : null}
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="col-span-2">
        <div className="font-mono text-xs break-all text-gray-800">{value || '—'}</div>
        {hint ? <div className="mt-1 text-[11px] text-gray-500 leading-4">{hint}</div> : null}
      </div>
    </div>
  );
}

export function ConfigView({ onScan, onAfterClear }) {
  "use no memo";
  const qc = useQueryClient();
  const win = isWindowsLike();

  const scanPlaceholder = win ? '例如：D:\\Photos 或 \\\\NAS\\share\\Photos' : '例如：/Users/yourname/Pictures/Import';

  const cfgQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 2_000,
  });

  const scanStatus = useQuery({
    queryKey: ['scanStatus'],
    queryFn: getScanStatus,
    refetchInterval: 1000,
  });

  const scanFacesMutation = useMutation({
    mutationFn: scanFaces,
    onSuccess: () => {
      // There is no progress API yet; face scan runs in server background.
      // Tell user how to observe results.
      alert('已开始后台补扫人脸：请稍等片刻，然后打开任意图片详情查看 PEOPLE 区域。');
    },
    onError: (e) => {
      alert(`启动人脸补扫失败：${String(e?.message || e)}`);
    },
  });

  const resetFaceMarkerMutation = useMutation({
    mutationFn: ({ clearFaces, clearPeople }) => resetFaceScanMarker({ clearFaces, clearPeople }),
    onSuccess: (r) => {
      alert(`已重置人脸扫描标记。\nassetsReset=${r.assetsReset}\nclearFaces=${r.clearFaces}\nclearPeople=${r.clearPeople}`);
    },
    onError: (e) => alert(`重置失败：${String(e?.message || e)}`),
  });

  const reclusterMutation = useMutation({
    mutationFn: ({ eps, minSamples }) => reclusterFaces({ eps, minSamples }),
    onSuccess: (r) => {
      alert(
        `重聚类完成：\n` +
          `people=${r?.result?.people}\n` +
          `clusters=${r?.result?.clusters}\n` +
          `noise=${r?.result?.noise}\n` +
          `faces=${r?.result?.faces}\n` +
          `eps=${r?.result?.eps}`
      );
      qc.invalidateQueries({ queryKey: ['people'] });
      qc.invalidateQueries({ queryKey: ['faces'] });
    },
    onError: (e) => alert(`重聚类失败：${String(e?.message || e)}`),
  });

  const rebuildThumbsMutation = useMutation({
    mutationFn: ({ mode }) => rebuildThumbs({ mode }),
    onSuccess: (r) => {
      const total = r?.total ?? '—';
      alert(`已开始后台重建缩略图（共 ${total} 项）。\n期间可继续使用，网格会陆续刷新。`);
    },
    onError: (e) => {
      alert(`启动缩略图重建失败：${String(e?.message || e)}`);
    },
  });

  const scanRoots = useMemo(() => cfgQuery.data?.scan?.scanRoots || [], [cfgQuery.data]);
  const scanType = useMemo(() => cfgQuery.data?.scan?.scanType || { exts: [], includeNoExt: false }, [cfgQuery.data]);
  const workspace = useMemo(() => cfgQuery.data?.workspace || {}, [cfgQuery.data]);

  const enabledRoots = useMemo(() => scanRoots.filter((r) => r?.enabled), [scanRoots]);
  const enabledCount = enabledRoots.length;

  const [rootInput, setRootInput] = useState('');

  const addRootMutation = useMutation({
    mutationFn: (root) => addScanRoot({ root }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      setRootInput('');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ root, enabled }) => setScanRootEnabled({ root, enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ root, clearDb }) => removeScanRoot({ root, clearDb }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['config'] });
      onAfterClear?.();
      setRemoveOpen(false);
      setRemoveTarget(null);
      setRemoveClearDb(false);
      setRemoveDryRun(null);
      setRemoveDryRunRoot('');
      if (res?.clearReport) {
        // Keep last report visible in dialog after closing? For now no.
      }
    },
  });

  // ---- Scan type editor (global) ----
  const [extInput, setExtInput] = useState('');
  const [typeExts, setTypeExts] = useState([]);
  const [includeNoExt, setIncludeNoExt] = useState(false);
  const [typeDirty, setTypeDirty] = useState(false);

  useEffect(() => {
    if (typeDirty) return;
    const exts = Array.isArray(scanType.exts) ? scanType.exts : [];
    setTypeExts(exts.map((e) => String(e).toLowerCase()).filter(Boolean));
    setIncludeNoExt(!!scanType.includeNoExt);
  }, [scanType.exts, scanType.includeNoExt, typeDirty]);

  const canSaveType = (typeExts.length > 0) || includeNoExt;

  const saveTypeMutation = useMutation({
    mutationFn: ({ exts, includeNoExt: inc }) => setScanType({ exts, includeNoExt: inc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      setTypeDirty(false);
    },
  });

  const toggleExt = (raw) => {
    const e = normExt(raw);
    if (!e) return;
    setTypeDirty(true);
    setTypeExts((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : uniq([...prev, e])));
  };

  const addExtFromInput = () => {
    const e = normExt(extInput);
    if (!e) return;
    setTypeDirty(true);
    setTypeExts((prev) => (prev.includes(e) ? prev : uniq([...prev, e])));
    setExtInput('');
  };

  // const applyPreset = (which) => {
  //   setTypeDirty(true);
  //   if (which === 'image') {
  //     setTypeExts(uniq(IMAGE_EXTS));
  //     return;
  //   }
  //   if (which === 'video') {
  //     setTypeExts(uniq(VIDEO_EXTS));
  //     return;
  //   }
  //   if (which === 'media') {
  //     setTypeExts(uniq([...IMAGE_EXTS, ...VIDEO_EXTS]));
  //     return;
  //   }
  //   if (which === 'clear') {
  //     setTypeExts([]);
  //     return;
  //   }
  // };

  // ---- Remove dialog ----
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null); // root string
  const [removeClearDb, setRemoveClearDb] = useState(false);
  const [removeDryRun, setRemoveDryRun] = useState(null);
  const [removeDryRunRoot, setRemoveDryRunRoot] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);

  const openRemove = (root) => {
    setRemoveTarget(root);
    setRemoveClearDb(false);
    setRemoveDryRun(null);
    setRemoveDryRunRoot('');
    setRemoveOpen(true);
  };

  const doRemoveDryRun = async () => {
    const root = String(removeTarget || '').trim();
    if (!root) return;
    setRemoveBusy(true);
    try {
      const r = await clearLibraryByRoot({ root, dryRun: true });
      setRemoveDryRun(r);
      setRemoveDryRunRoot(root);
    } finally {
      setRemoveBusy(false);
    }
  };

  const canConfirmRemove =
    !!removeTarget &&
    (!removeClearDb || (removeDryRun?.dryRun && removeDryRunRoot === removeTarget)) &&
    !removeMutation.isPending &&
    !removeBusy;

  return (
    <div className="h-full w-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-4xl space-y-6">
        {/* Scan roots */}
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-gray-900">扫描源目录（可多选）</div>
              <div className="text-sm text-gray-600 mt-1 leading-6">
                类似网盘相册备份：你可以选择多个目录，并通过开关控制是否参与扫描。
                点击“扫描已启用目录”会按顺序扫描所有已启用目录。
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
              <div className="text-xs text-gray-500">
                已启用目录 <span className="tabular-nums font-semibold text-gray-900">{enabledCount}</span>
              </div>
              <Button
                size="lg"
                className="shadow-md"
                disabled={enabledCount === 0 || scanStatus.data?.isScanning || typeof onScan !== 'function'}
                onClick={() => onScan?.()}
                title={enabledCount === 0 ? '请先添加并启用至少一个目录' : '一键按顺序扫描所有已启用目录'}
              >
                <Play className="h-4 w-4" />
                一键扫描（{enabledCount}）
              </Button>

              <Button
                variant="outline"
                size="lg"
                disabled={scanStatus.data?.isScanning || scanFacesMutation.isPending}
                onClick={() => scanFacesMutation.mutate()}
                title="对历史库进行一次人脸补扫入库（只扫图片，已扫过的会跳过）"
              >
                {scanFacesMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                人脸补扫（入库）
              </Button>

              <Button
                variant="outline"
                size="lg"
                disabled={scanStatus.data?.isScanning || resetFaceMarkerMutation.isPending}
                onClick={() => {
                  const ok = window.confirm('将重置全库的人脸扫描标记，使图片可以重新参与人脸补扫。\\n是否继续？');
                  if (!ok) return;
                  const clearFaces = window.confirm('是否清空 faces 表？（会清掉所有人脸框/特征）');
                  const clearPeople = clearFaces ? window.confirm('是否同时清空 people 表？') : false;
                  resetFaceMarkerMutation.mutate({ clearFaces, clearPeople });
                }}
                title="重置 face_scanned_at（可选清空 faces/people），用于重新扫描/重新聚类"
              >
                {resetFaceMarkerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                重置人脸标记
              </Button>

              <Button
                variant="outline"
                size="lg"
                disabled={scanStatus.data?.isScanning || reclusterMutation.isPending}
                onClick={() => {
                  const epsRaw = window.prompt('输入 DBSCAN eps（cosine distance），建议 0.02~0.06：', '0.04');
                  if (epsRaw == null) return;
                  const minSamplesRaw = window.prompt('minSamples（建议 2）：', '2');
                  if (minSamplesRaw == null) return;
                  const eps = Number(epsRaw);
                  const minSamples = Number(minSamplesRaw);
                  reclusterMutation.mutate({ eps, minSamples });
                }}
                title="按现有 faces.descriptor 进行重聚类生成 people，并写回 faces.person_id"
              >
                {reclusterMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                重聚类（生成人物）
              </Button>

              <Button
                variant="outline"
                size="lg"
                disabled={scanStatus.data?.isScanning || scanStatus.data?.thumbRebuild?.isRunning || rebuildThumbsMutation.isPending}
                onClick={() => {
                  const ok = window.confirm('将重建全库缩略图（会占用一段时间，按 hash 逐个生成）。\n确认开始？');
                  if (!ok) return;
                  rebuildThumbsMutation.mutate({ mode: 'all' });
                }}
                title="删除并重新生成缩略图（用于缩略图策略变更、RAW 预览增强后全库刷新）"
              >
                {rebuildThumbsMutation.isPending || scanStatus.data?.thumbRebuild?.isRunning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                重建缩略图（全库）
              </Button>
              <div className="text-[11px] text-gray-500 leading-4 text-right max-w-[260px]">
                配置完目录与类型后点这里即可开始扫描
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Input
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder={`添加扫描目录（绝对路径）— ${scanPlaceholder}`}
            />
            <Button
              disabled={!rootInput.trim() || addRootMutation.isPending}
              onClick={() => addRootMutation.mutate(rootInput.trim())}
            >
              添加
            </Button>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-600">
              {scanStatus.data?.isScanning ? (
                <>
                  正在扫描：<span className="font-mono">{scanStatus.data?.currentRoot || '—'}</span>
                  {Number.isFinite(scanStatus.data?.queueDone) && Number.isFinite(scanStatus.data?.queueTotal) ? (
                    <span className="ml-2 tabular-nums text-gray-500">
                      ({scanStatus.data.queueDone}/{scanStatus.data.queueTotal})
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  未在扫描
                  {scanStatus.data?.thumbRebuild?.isRunning ? (
                    <span className="ml-3 text-gray-500 tabular-nums">
                      缩略图重建中 ({scanStatus.data.thumbRebuild.done}/{scanStatus.data.thumbRebuild.total})
                    </span>
                  ) : null}
                </>
              )}
            </div>
            <div className="text-[11px] text-gray-500">
              扫描会按顺序处理已启用目录，避免同时扫描导致磁盘/CPU 抖动
            </div>
          </div>

          <Separator className="my-4" />

          <div className="text-sm font-semibold text-gray-800 mb-2">目录列表</div>
          {cfgQuery.isLoading ? (
            <div className="text-sm text-gray-600">加载中…</div>
          ) : scanRoots.length ? (
            <div className="space-y-2">
              {scanRoots.map((it) => {
                const root = it?.root;
                const enabled = !!it?.enabled;
                return (
                  <div key={root} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 bg-white">
                    <div className="min-w-0">
                      <div className="font-mono text-xs break-all text-gray-800">{root}</div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {enabled ? '已启用：会参与扫描' : '已停用：不会参与扫描'}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-gray-500">启用</div>
                        <Switch
                          checked={enabled}
                          disabled={toggleMutation.isPending}
                          onCheckedChange={(ck) => toggleMutation.mutate({ root, enabled: !!ck })}
                          aria-label="启用/停用扫描"
                        />
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openRemove(root)} title="移除目录">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600 leading-6">
              还没有扫描目录。默认会从 <span className="font-mono text-xs">{String(workspace.WORK_ROOT || '').trim() || 'WORK_ROOT'}</span> 扫描（首次启动会自动写入到 config.json）。
            </div>
          )}
        </div>

        {/* Scan type */}
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">扫描文件类型（全局）</div>
          <div className="text-sm text-gray-600 mt-1 leading-6">
            该设置会在扫描阶段生效：只有命中的文件才会写入 DB、生成缩略图。
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
             <div className="text-sm font-semibold text-gray-800">图片格式</div>
             <div className="flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => {
                  setTypeDirty(true);
                  setTypeExts(prev => uniq([...prev, ...IMAGE_EXTS]));
                }}>全选</Button>
                <Button size="xs" variant="ghost" onClick={() => {
                   setTypeDirty(true);
                   setTypeExts(prev => prev.filter(e => !IMAGE_EXTS.includes(e)));
                }}>全不选</Button>
             </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {IMAGE_EXTS.map((e) => {
              const on = typeExts.includes(e);
              return (
                <Button
                  key={e}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleExt(e)}
                  className={on ? "bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200" : "text-gray-600"}
                >
                  .{e}
                </Button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
             <div className="text-sm font-semibold text-gray-800">视频格式</div>
             <div className="flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => {
                  setTypeDirty(true);
                  setTypeExts(prev => uniq([...prev, ...VIDEO_EXTS]));
                }}>全选</Button>
                 <Button size="xs" variant="ghost" onClick={() => {
                   setTypeDirty(true);
                   setTypeExts(prev => prev.filter(e => !VIDEO_EXTS.includes(e)));
                }}>全不选</Button>
             </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {VIDEO_EXTS.map((e) => {
              const on = typeExts.includes(e);
              return (
                <Button
                  key={e}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleExt(e)}
                  className={on ? "bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200" : "text-gray-600"}
                >
                  .{e}
                </Button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-2">
             <div className="text-sm font-semibold text-gray-800">其他/自定义</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            {OTHER_MEDIA_EXTS.map((e) => {
               const on = typeExts.includes(e);
               return (
                <Button
                  key={e}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleExt(e)}
                  className={on ? "bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200" : "text-gray-600"}
                >
                  .{e}
                </Button>
               );
            })}
             <Separator orientation="vertical" className="h-6 mx-2" />
             <div className="flex gap-2">
                <Input
                  className="w-32 h-8 text-sm"
                  value={extInput}
                  onChange={(e) => setExtInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExtFromInput();
                    }
                  }}
                  placeholder="手动添加..."
                />
                <Button type="button" variant="outline" size="sm" disabled={!extInput.trim()} onClick={addExtFromInput}>
                  添加
                </Button>
             </div>
          </div>
          
          <div className="mt-3 flex flex-wrap gap-2">
             {typeExts.filter(e => !IMAGE_EXTS.includes(e) && !VIDEO_EXTS.includes(e) && !OTHER_MEDIA_EXTS.includes(e)).map(e => (
                 <Button
                  key={e}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => toggleExt(e)}
                  className="bg-gray-100 text-gray-700 hover:bg-gray-200 border-dashed border-gray-300 border"
                  title="点击移除"
                >
                  .{e} <X className="ml-1 h-3 w-3 opacity-50" />
                </Button>
             ))}
          </div>
          
          <div className="mt-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <Checkbox
                checked={includeNoExt}
                onCheckedChange={(ck) => {
                  setTypeDirty(true);
                  setIncludeNoExt(!!ck);
                }}
              />
              <span>包含无后缀文件</span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {!canSaveType ? '至少选择一个后缀或勾选“包含无后缀”才能保存。' : (typeDirty ? '有未保存的修改' : '已保存')}
            </div>
            <Button
              disabled={!typeDirty || !canSaveType || saveTypeMutation.isPending}
              onClick={() => saveTypeMutation.mutate({ exts: typeExts, includeNoExt })}
              title="保存后会影响后续扫描入库的文件类型"
            >
              保存扫描类型
            </Button>
          </div>
        </div>
        
        {/* Workspace readonly */}
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">工具工作区（只读）</div>
          <div className="text-sm text-gray-600 mt-1 leading-6">
            这里是工具用于存放 <span className="font-mono text-xs">_Tidy/_Trash</span> 以及本地数据（DB/缩略图）的目录。
            它与“扫描源目录”无关，保持稳定更安全。
          </div>

          <div className="mt-4 space-y-3">
            <Row label="WORK_ROOT" value={workspace.WORK_ROOT} hint="工具工作区根目录" />
            <Row label="MANAGED_ROOT" value={workspace.MANAGED_ROOT} hint="派生：MANAGED_ROOT = WORK_ROOT/_Tidy" />
            <Row label="TRASH_DIR" value={workspace.TRASH_DIR} hint="派生：TRASH_DIR = MANAGED_ROOT/_Trash" />
            <Separator className="my-2" />
            <Row label="DATA_DIR" value={workspace.DATA_DIR} hint="本地数据目录（默认 server/data）" />
            <Row label="DB_PATH" value={workspace.DB_PATH} hint="SQLite 数据库文件路径" />
            <Row label="THUMB_DIR" value={workspace.THUMB_DIR} hint="缩略图目录" />
          </div>
        </div>
      </div>

      {/* Remove dialog */}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移除扫描目录</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="text-gray-600">
              目录：<div className="mt-1 font-mono text-xs break-all text-gray-800">{removeTarget || '—'}</div>
            </div>

            <label className="flex items-center gap-2">
              <Checkbox
                checked={removeClearDb}
                onCheckedChange={(ck) => {
                  setRemoveClearDb(!!ck);
                  setRemoveDryRun(null);
                  setRemoveDryRunRoot('');
                }}
              />
              <span>同时清除该目录的 DB 记录（仅清 DB，不删磁盘文件）</span>
            </label>

            {removeClearDb ? (
              <div className="rounded-lg border bg-gray-50 p-3">
                <div className="text-xs text-gray-600 leading-5">
                  建议先预估（dry-run）确认数量，再执行移除+清理。
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    disabled={removeBusy || !removeTarget}
                    onClick={doRemoveDryRun}
                  >
                    {removeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    预估（dry-run）
                  </Button>
                </div>

                {removeDryRun ? (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric label="匹配 files" value={removeDryRun.matchedFiles} />
                    <Metric label="涉及 hash" value={removeDryRun.matchedHashes} />
                    <Metric label="预计孤儿 hash" value={removeDryRun.orphanHashesEstimate} />
                    <Metric label="模式" value="dry-run" />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRemoveOpen(false)}
                disabled={removeMutation.isPending || removeBusy}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={!canConfirmRemove || removeBusy || removeMutation.isPending}
                onClick={() => {
                  if (!removeTarget) return;
                  if (!removeClearDb) {
                    // Simple remove (no DB clear), just confirm and do it.
                    const ok = window.confirm(`确认移除目录？\n${removeTarget}`);
                    if (!ok) return;
                    removeMutation.mutate({ root: removeTarget, clearDb: false });
                    return;
                  }
                  
                  // For clear DB, we don't use window.confirm again because the button is scary enough
                  // and we force dry-run or direct action.
                  // Actually, let's just do it.
                  removeMutation.mutate({ root: removeTarget, clearDb: true });
                }}
              >
                {removeBusy || removeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                确认移除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


