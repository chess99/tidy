/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addScanRoot,
  clearLibraryByRoot,
  createJob,
  getConfig,
  removeScanRoot,
  setScanOptions,
  setScanRootEnabled,
  setScanType,
  setTaskSettings,
} from '../api/client';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
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
const OTHER_MEDIA_EXTS = ['ts', 'mts', 'm2ts'];

function uniq(arr) {
  return Array.from(new Set(arr));
}

function Card({ title, id, children, desc, right }) {
  return (
    <section id={id} className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-gray-900">{title}</div>
          {desc ? <div className="text-sm text-gray-600 mt-1 leading-6">{desc}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ScanTypeSection({ scanType, onSave }) {
  const [extInput, setExtInput] = useState('');
  const [typeExts, setTypeExts] = useState(() => {
    const exts = Array.isArray(scanType?.exts) ? scanType.exts : [];
    return exts.map((e) => String(e).toLowerCase()).filter(Boolean);
  });
  const [includeNoExt, setIncludeNoExt] = useState(() => !!scanType?.includeNoExt);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggleExt = (raw) => {
    const e = normExt(raw);
    if (!e) return;
    setDirty(true);
    setTypeExts((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : uniq([...prev, e])));
  };

  const addExtFromInput = () => {
    const e = normExt(extInput);
    if (!e) return;
    setDirty(true);
    setTypeExts((prev) => (prev.includes(e) ? prev : uniq([...prev, e])));
    setExtInput('');
  };

  const canSave = (typeExts.length > 0) || includeNoExt;

  return (
    <>
      <div className="text-sm font-semibold text-gray-800 mb-2">图片格式</div>
      <div className="flex flex-wrap gap-2">
        {IMAGE_EXTS.map((e) => {
          const on = typeExts.includes(e);
          return (
            <Button
              key={e}
              type="button"
              variant={on ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => toggleExt(e)}
              className={on ? 'bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200' : 'text-gray-600'}
            >
              .{e}
            </Button>
          );
        })}
      </div>

      <div className="mt-4 text-sm font-semibold text-gray-800 mb-2">视频格式</div>
      <div className="flex flex-wrap gap-2">
        {VIDEO_EXTS.map((e) => {
          const on = typeExts.includes(e);
          return (
            <Button
              key={e}
              type="button"
              variant={on ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => toggleExt(e)}
              className={on ? 'bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200' : 'text-gray-600'}
            >
              .{e}
            </Button>
          );
        })}
      </div>

      <div className="mt-4 text-sm font-semibold text-gray-800 mb-2">其他/自定义</div>
      <div className="flex flex-wrap gap-2 items-center">
        {OTHER_MEDIA_EXTS.map((e) => {
          const on = typeExts.includes(e);
          return (
            <Button
              key={e}
              type="button"
              variant={on ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => toggleExt(e)}
              className={on ? 'bg-blue-100 text-blue-900 border-blue-200 hover:bg-blue-200' : 'text-gray-600'}
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

      <div className="mt-4">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <Checkbox
            checked={includeNoExt}
            onCheckedChange={(ck) => {
              setDirty(true);
              setIncludeNoExt(!!ck);
            }}
          />
          <span>包含无后缀文件</span>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {!canSave ? '至少选择一个后缀或勾选“包含无后缀”才能保存。' : (dirty ? '有未保存的修改' : '已保存')}
        </div>
        <Button
          disabled={!dirty || !canSave || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave?.({ exts: typeExts, includeNoExt });
              setDirty(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存扫描类型
        </Button>
      </div>
    </>
  );
}

function ScanOptionsSection({ scan, onSave }) {
  const [globInput, setGlobInput] = useState('');
  const [excludeGlobs, setExcludeGlobs] = useState(() => (Array.isArray(scan?.excludeGlobs) ? scan.excludeGlobs.slice() : []));
  const [minBytes, setMinBytes] = useState(() => Number(scan?.minFileSizeBytes || 0) || 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const addGlob = () => {
    const s = String(globInput || '').trim();
    if (!s) return;
    setDirty(true);
    setExcludeGlobs((prev) => uniq([...prev, s]));
    setGlobInput('');
  };

  const removeGlob = (g) => {
    setDirty(true);
    setExcludeGlobs((prev) => prev.filter((x) => x !== g));
  };

  return (
    <>
      <div className="flex gap-2">
        <Input value={globInput} onChange={(e) => setGlobInput(e.target.value)} placeholder="例如：**/.git/**" />
        <Button variant="outline" disabled={!globInput.trim()} onClick={addGlob}>添加</Button>
      </div>

      <div className="mt-3 space-y-2">
        {excludeGlobs.map((g) => (
          <div key={g} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 bg-white">
            <div className="font-mono text-xs break-all text-gray-800">{g}</div>
            <Button variant="ghost" size="sm" onClick={() => removeGlob(g)}>移除</Button>
          </div>
        ))}
        {excludeGlobs.length === 0 ? <div className="text-sm text-gray-500">未设置</div> : null}
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-800 mb-2">最小文件大小</div>
        <div className="flex items-center gap-2">
          <Input
            className="w-40"
            type="number"
            value={minBytes}
            onChange={(e) => {
              setDirty(true);
              setMinBytes(Number(e.target.value) || 0);
            }}
          />
          <span className="text-xs text-gray-500">bytes（例如 1024 = 1KB）</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">{dirty ? '有未保存的修改' : '已保存'}</div>
        <Button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave?.({ excludeGlobs, minFileSizeBytes: minBytes });
              setDirty(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存扫描规则
        </Button>
      </div>
    </>
  );
}

function TaskSettingsSection({ tasks, onSave }) {
  const base = { discover: 1, enrich: 4, faces: 1, thumbs: 1 };
  const [concurrency, setConcurrency] = useState(() => ({ ...base, ...(tasks?.concurrency || {}) }));
  const [afterDiscover, setAfterDiscover] = useState(() => (Array.isArray(tasks?.autoTrigger?.afterDiscover) ? tasks.autoTrigger.afterDiscover.slice() : []));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {['discover', 'enrich', 'thumbs', 'faces'].map((k) => (
          <div key={k} className="space-y-1">
            <div className="text-xs text-gray-500">{k}</div>
            <Input
              type="number"
              value={concurrency[k]}
              onChange={(e) => {
                setDirty(true);
                setConcurrency((prev) => ({ ...prev, [k]: Number(e.target.value) || 1 }));
              }}
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-800 mb-2">Discover 完成后自动触发</div>
        <div className="flex flex-wrap gap-3 text-sm">
          {['enrich', 'clip', 'ocr'].map((t) => {
            const on = afterDiscover.includes(t);
            return (
              <label key={t} className="inline-flex items-center gap-2">
                <Checkbox
                  checked={on}
                  onCheckedChange={(ck) => {
                    setDirty(true);
                    setAfterDiscover((prev) => {
                      const next = new Set(prev);
                      if (ck) next.add(t);
                      else next.delete(t);
                      return Array.from(next);
                    });
                  }}
                />
                <span>{t}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">{dirty ? '有未保存的修改' : '已保存'}</div>
        <Button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave?.({ concurrency, autoTrigger: { afterDiscover } });
              setDirty(false);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          保存任务设置
        </Button>
      </div>
    </>
  );
}

export function SettingsView({ anchor }) {
  const qc = useQueryClient();
  const win = isWindowsLike();
  const scanPlaceholder = win ? '例如：D:\\Photos 或 \\\\NAS\\share\\Photos' : '例如：/Users/yourname/Pictures/Import';

  const cfgQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 2_000,
  });

  const scanRoots = useMemo(() => cfgQuery.data?.scanRoots || [], [cfgQuery.data]);
  const scanType = useMemo(() => cfgQuery.data?.scanType || { exts: [], includeNoExt: false }, [cfgQuery.data]);
  const scanOpts = useMemo(() => cfgQuery.data?.scan || { excludeGlobs: [], minFileSizeBytes: 0 }, [cfgQuery.data]);
  const tasks = useMemo(() => cfgQuery.data?.tasks || { concurrency: {}, autoTrigger: { afterDiscover: [] } }, [cfgQuery.data]);
  const workspace = useMemo(() => cfgQuery.data?.workspace || {}, [cfgQuery.data]);

  // ---- Scan roots ----
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const removeMutation = useMutation({
    mutationFn: ({ root, clearDb }) => removeScanRoot({ root, clearDb }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  // ---- Maintenance: face reset job ----
  const faceResetMutation = useMutation({
    mutationFn: ({ clearFaces, clearPeople }) => createJob({ type: 'faces_reset', mode: 'missing', params: { clearFaces, clearPeople } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  // Anchor scroll (best-effort)
  useEffect(() => {
    if (!anchor) return;
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [anchor]);

  const enabledCount = scanRoots.filter((r) => r?.enabled).length;

  const scanTypeKey = `scanType:${(scanType.exts || []).join(',')}:${scanType.includeNoExt ? 1 : 0}`;
  const scanOptsKey = `scanOpts:${(scanOpts.excludeGlobs || []).join('|')}:${Number(scanOpts.minFileSizeBytes || 0)}`;
  const tasksKey = `tasks:${JSON.stringify(tasks || {})}`;

  return (
    <div className="h-full w-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-4xl space-y-6">
        <div>
          <div className="text-2xl font-bold text-gray-900">设置</div>
          <div className="text-sm text-gray-600 mt-1">集中管理扫描与任务并发配置（任务页可一键跳转到这里）。</div>
        </div>

        <Card
          id="scan"
          title="扫描源目录（可多选）"
          desc="添加多个绝对路径，通过开关控制是否参与扫描（Discover）。"
          right={<div className="text-xs text-gray-500">已启用 <span className="tabular-nums font-semibold text-gray-900">{enabledCount}</span></div>}
        >
          <div className="flex gap-2">
            <Input
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder={`添加扫描目录（绝对路径）— ${scanPlaceholder}`}
            />
            <Button disabled={!rootInput.trim() || addRootMutation.isPending} onClick={() => addRootMutation.mutate(rootInput.trim())}>
              {addRootMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              添加
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {scanRoots.length ? scanRoots.map((it) => {
              const root = it?.root;
              const enabled = !!it?.enabled;
              return (
                <div key={root} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 bg-white">
                  <div className="min-w-0">
                    <div className="font-mono text-xs break-all text-gray-800">{root}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{enabled ? '已启用' : '已停用'}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-500">启用</div>
                      <Switch
                        checked={enabled}
                        disabled={toggleMutation.isPending}
                        onCheckedChange={(ck) => toggleMutation.mutate({ root, enabled: !!ck })}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const clearDb = window.confirm('移除目录时是否同时清除 DB 记录？（仅清 DB，不删磁盘文件）');
                        removeMutation.mutate({ root, clearDb });
                      }}
                      title="移除目录"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            }) : (
              <div className="text-sm text-gray-600">
                还没有扫描目录。默认会从 <span className="font-mono text-xs">{String(workspace.WORK_ROOT || '').trim() || 'WORK_ROOT'}</span> 扫描（首次启动会自动写入到 config.json）。
              </div>
            )}
          </div>
        </Card>

        <Card
          id="scanType"
          title="扫描文件类型（全局）"
          desc="Discover 阶段会按后缀过滤，命中的文件才会进入入库补全（Enrich）。"
        >
          <ScanTypeSection
            key={scanTypeKey}
            scanType={scanType}
            onSave={async ({ exts, includeNoExt }) => {
              await setScanType({ exts, includeNoExt });
              qc.invalidateQueries({ queryKey: ['config'] });
            }}
          />
        </Card>

        <Card
          id="exclude"
          title="扫描排除规则（Glob）"
          desc="跳过不需要扫描的目录/文件（语法参考：**/node_modules/**）。"
        >
          <ScanOptionsSection
            key={scanOptsKey}
            scan={scanOpts}
            onSave={async ({ excludeGlobs, minFileSizeBytes }) => {
              await setScanOptions({ excludeGlobs, minFileSizeBytes });
              qc.invalidateQueries({ queryKey: ['config'] });
            }}
          />
        </Card>

        <Card id="concurrency" title="任务并发" desc="控制各任务的并发策略（Enrich 内部会用并发提升吞吐）。">
          <TaskSettingsSection
            key={tasksKey}
            tasks={tasks}
            onSave={async ({ concurrency, autoTrigger }) => {
              await setTaskSettings({ concurrency, autoTrigger });
              qc.invalidateQueries({ queryKey: ['config'] });
            }}
          />
        </Card>

        <Card id="faces" title="人脸系统（维护）" desc="用于重新扫描/清理/聚类等维护动作。">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={faceResetMutation.isPending}
              onClick={() => {
                const ok = window.confirm('将重置全库的人脸扫描标记，使图片可以重新参与人脸补扫。\\n是否继续？');
                if (!ok) return;
                const clearFaces = window.confirm('是否清空 faces 表？（会清掉所有人脸框/特征）');
                const clearPeople = clearFaces ? window.confirm('是否同时清空 people 表？') : false;
                faceResetMutation.mutate({ clearFaces, clearPeople });
              }}
            >
              {faceResetMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              重置人脸标记（Job）
            </Button>
          </div>
        </Card>

        <Card id="sync" title="同步/对账" desc="高风险操作的可观测入口：清理某扫描目录的 DB 记录等。">
          <div className="text-sm text-gray-600">
            目录级清理（仅清 DB，不删磁盘文件）：用于移除扫描根或重扫前清理。
          </div>
          <div className="mt-3 flex gap-2">
            <Input placeholder="输入要清理的 root（绝对路径）" id="clearRootInput" />
            <Button
              variant="outline"
              onClick={async () => {
                const root = document.getElementById('clearRootInput')?.value?.trim();
                if (!root) return;
                const dry = await clearLibraryByRoot({ root, dryRun: true });
                const ok = window.confirm(`dry-run 预估：\\nfiles=${dry.matchedFiles}\\nhashes=${dry.matchedHashes}\\n继续执行清理？`);
                if (!ok) return;
                await clearLibraryByRoot({ root, dryRun: false });
                qc.invalidateQueries({ queryKey: ['files'] });
                qc.invalidateQueries({ queryKey: ['assets'] });
                qc.invalidateQueries({ queryKey: ['albums'] });
              }}
            >
              预估并清理
            </Button>
          </div>
        </Card>

        <Card id="ai" title="AI（预留）" desc="未来接入 CLIP/OCR 时使用，当前仅保留开关与扩展位。">
          <div className="text-sm text-gray-500">暂无更多设置</div>
        </Card>

        <Card id="workspace" title="工具工作区（只读）" desc="工具用于存放 _Tidy/_Trash 与本地数据（DB/缩略图）的目录。">
          <div className="text-xs text-gray-700 space-y-2">
            {['WORK_ROOT', 'MANAGED_ROOT', 'TRASH_DIR', 'DATA_DIR', 'DB_PATH', 'THUMB_DIR'].map((k) => (
              <div key={k} className="grid grid-cols-3 gap-3">
                <div className="text-gray-500">{k}</div>
                <div className="col-span-2 font-mono break-all">{workspace?.[k] || '—'}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}


