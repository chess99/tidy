import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { addScanRoot, clearLibraryByRoot, getConfig, setActiveScanRoot } from '../api/client';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';

function isWindowsLike() {
  try {
    const p = String(navigator?.platform || '').toLowerCase();
    const ua = String(navigator?.userAgent || '').toLowerCase();
    return p.includes('win') || ua.includes('windows');
  } catch {
    return false;
  }
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{Number.isFinite(value) ? value : (value ?? '—')}</div>
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
  const [rootInput, setRootInput] = useState('');
  const [clearRoot, setClearRoot] = useState('');
  const [dryRunResult, setDryRunResult] = useState(null); // last result (dry-run or execute)
  const [dryRunRoot, setDryRunRoot] = useState(''); // root used for the last dry-run
  const [clearBusy, setClearBusy] = useState(false);

  const cfgQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5_000,
  });

  const scanRoots = cfgQuery.data?.scan?.scanRoots || cfgQuery.data?.scanRoots || [];
  const activeScanRoot = cfgQuery.data?.scan?.activeScanRoot || cfgQuery.data?.activeScanRoot || null;
  const effectiveScanRoot =
    cfgQuery.data?.scan?.effectiveScanRoot ||
    cfgQuery.data?.effective?.scanRoot ||
    null;

  const addRootMutation = useMutation({
    mutationFn: ({ root, setActive }) => addScanRoot({ root, setActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      setRootInput('');
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ root }) => setActiveScanRoot({ root }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const effectivePairs = useMemo(() => {
    const workspace = cfgQuery.data?.workspace || cfgQuery.data?.effective || {};
    return [
      ['WORK_ROOT', workspace.WORK_ROOT],
      ['MANAGED_ROOT', workspace.MANAGED_ROOT],
      ['TRASH_DIR', workspace.TRASH_DIR],
      ['DATA_DIR', workspace.DATA_DIR],
      ['DB_PATH', workspace.DB_PATH],
      ['THUMB_DIR', workspace.THUMB_DIR],
    ];
  }, [cfgQuery.data]);

  const onDryRun = async () => {
    const root = (clearRoot || '').trim();
    if (!root) return;
    setClearBusy(true);
    try {
      const r = await clearLibraryByRoot({ root, dryRun: true });
      setDryRunResult(r);
      setDryRunRoot(root);
    } finally {
      setClearBusy(false);
    }
  };

  const onConfirmClear = async () => {
    const root = (clearRoot || '').trim();
    if (!root) return;
    setClearBusy(true);
    try {
      const r = await clearLibraryByRoot({ root, dryRun: false });
      setDryRunResult(r);
      setDryRunRoot('');
      onAfterClear?.();
      qc.invalidateQueries({ queryKey: ['config'] });
    } finally {
      setClearBusy(false);
    }
  };

  const win = isWindowsLike();
  const scanPlaceholder = win ? '例如：D:\\Photos 或 \\\\NAS\\share\\Photos' : '例如：/Users/yourname/Pictures/Import';
  const clearPlaceholder = win ? '例如：D:\\Photos\\2025' : '例如：/Users/yourname/Pictures/2025';

  const canExecuteClear =
    !!dryRunResult &&
    !!dryRunResult.dryRun &&
    !!dryRunRoot &&
    dryRunRoot.trim() === clearRoot.trim() &&
    !clearBusy;

  return (
    <div className="h-full w-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-3xl space-y-6">
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-gray-900">扫描源目录</div>
              <div className="text-sm text-gray-600 mt-1 leading-6">
                这里决定 <span className="font-semibold">从哪里扫描/建立索引</span>。
                不影响工具工作区（_Tidy/_Trash、DB、缩略图）的归属位置。
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-gray-500">当前默认扫描目录</div>
              <div className="mt-1 font-mono text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-100 max-w-[360px] break-all">
                {effectiveScanRoot || '—'}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder={`添加扫描目录（绝对路径）— ${scanPlaceholder}`}
              />
              <Button
                disabled={!rootInput.trim() || addRootMutation.isPending}
                onClick={() => addRootMutation.mutate({ root: rootInput.trim(), setActive: true })}
                title="添加并设为默认扫描目录"
              >
                添加并设为默认
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={!effectiveScanRoot || typeof onScan !== 'function'}
                onClick={() => onScan?.(effectiveScanRoot)}
              >
                扫描默认目录
              </Button>
              <div className="text-xs text-gray-500 leading-5">
                默认扫描目录来自：<span className="font-mono">{activeScanRoot || '（未设置，回退到 WORK_ROOT）'}</span>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="text-sm font-semibold text-gray-800 mb-2">已保存的扫描目录</div>
          {cfgQuery.isLoading ? (
            <div className="text-sm text-gray-600">加载中…</div>
          ) : scanRoots.length ? (
            <div className="space-y-2">
              {scanRoots.map((r) => {
                const isActive = String(activeScanRoot || '') === String(r);
                return (
                  <div key={r} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 bg-white">
                    <div className="min-w-0">
                      <div className="font-mono text-xs break-all text-gray-800">{r}</div>
                      {isActive ? <div className="text-[11px] text-blue-600 mt-1">默认扫描目录（active）</div> : <div className="text-[11px] text-gray-500 mt-1">可设为默认扫描目录</div>}
                    </div>
                    <div className="shrink-0 flex gap-2">
                      <Button
                        variant={isActive ? 'secondary' : 'outline'}
                        size="sm"
                        disabled={isActive || setActiveMutation.isPending}
                        onClick={() => setActiveMutation.mutate({ root: r })}
                      >
                        设为默认
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600 leading-6">
              你还没有保存扫描目录。此时会回退使用 <span className="font-mono text-xs">WORK_ROOT</span> 作为默认扫描目录（通常是 Pictures）。
            </div>
          )}
        </div>

        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">清除目录记录（仅清 DB）</div>
          <div className="text-sm text-gray-600 mt-1 leading-6">
            用于“误扫/换目录”后清理索引。<span className="font-semibold">不会删除磁盘文件</span>，只会删除 SQLite 中对应目录前缀的记录（files/assets/归档/标签/变更等关联）。
            建议先预估（dry-run），确认数量后再执行。
          </div>

          <div className="mt-4 flex gap-2">
            <Input
              value={clearRoot}
              onChange={(e) => setClearRoot(e.target.value)}
              placeholder={`要清理的目录（绝对路径）— ${clearPlaceholder}`}
            />
            <Button variant="outline" disabled={!clearRoot.trim() || clearBusy} onClick={onDryRun}>
              先预估（dry-run）
            </Button>
          </div>

          {dryRunResult ? (
            <div className="mt-4 rounded-xl border bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">报告</div>
                  <div className="mt-1 text-xs text-gray-600">
                    root: <span className="font-mono">{dryRunResult.root}</span>
                    <span className="ml-3">mode: <span className="font-mono">{dryRunResult.dryRun ? 'dry-run' : 'executed'}</span></span>
                  </div>
                </div>
                {dryRunResult.dryRun ? (
                  <Button
                    variant="destructive"
                    disabled={!canExecuteClear}
                    title={!canExecuteClear ? '请先对当前输入的目录完成 dry-run' : '执行清除（不可撤销）'}
                    onClick={() => {
                      const ok = window.confirm(
                        `确认执行清除？（仅清 DB）\n\n目录：${clearRoot.trim()}\n\n将删除：files≈${dryRunResult.matchedFiles}，hash≈${dryRunResult.matchedHashes}\n\n不会删除磁盘文件，但会影响列表/归档/标签/变更等关联。`
                      );
                      if (!ok) return;
                      onConfirmClear();
                    }}
                  >
                    确认执行清除
                  </Button>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="匹配文件(files)" value={dryRunResult.matchedFiles} hint="路径前缀命中的 files 行数" />
                <Metric label="涉及内容(hash)" value={dryRunResult.matchedHashes} hint="同一内容的多份副本算 1 个 hash" />
                {dryRunResult.dryRun ? (
                  <Metric label="预计孤儿内容" value={dryRunResult.orphanHashesEstimate} hint="清完后可能没有任何文件引用的 hash" />
                ) : (
                  <Metric label="清理孤儿内容" value={dryRunResult.orphanHashes} hint="执行后实际清掉的孤儿 hash 数" />
                )}
                {dryRunResult.dryRun ? (
                  <Metric label="下一步" value="执行" hint="点击右上角按钮进行不可撤销的清除" />
                ) : (
                  <Metric label="已删除 files" value={dryRunResult.deletedFiles} hint="已从 DB 删除的 files 行数" />
                )}
              </div>

              {!dryRunResult.dryRun ? (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Metric label="已删除 assets" value={dryRunResult.deletedAssets} />
                  <Metric label="已删除归档关联" value={dryRunResult.deletedAlbumLinks} />
                  <Metric label="已删除标签关联" value={dryRunResult.deletedTagLinks} />
                  <Metric label="已删除变更/操作" value={(Number(dryRunResult.deletedChanges) || 0) + (Number(dryRunResult.deletedOps) || 0)} />
                </div>
              ) : (
                <div className="mt-3 text-xs text-gray-500 leading-5">
                  提示：如果你修改了输入框中的目录，请重新执行 dry-run，按钮才会允许执行清除。
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">工具工作区（只读）</div>
          <div className="text-sm text-gray-600 mt-1 leading-6">
            这里是工具的“工作库/存放目录”，用于放置 <span className="font-mono text-xs">_Tidy/_Trash</span> 以及本地数据（DB/缩略图）。
            它来自 <span className="font-mono text-xs">WORK_ROOT</span>（默认 <span className="font-mono text-xs">~/Pictures</span>），不会随扫描源目录变化。
          </div>

          <div className="mt-4 space-y-3">
            <Row label="WORK_ROOT" value={effectivePairs[0]?.[1]} hint="工具工作区根目录（默认 Pictures）" />
            <Row label="MANAGED_ROOT" value={effectivePairs[1]?.[1]} hint="派生：MANAGED_ROOT = WORK_ROOT/_Tidy" />
            <Row label="TRASH_DIR" value={effectivePairs[2]?.[1]} hint="派生：TRASH_DIR = MANAGED_ROOT/_Trash" />
            <Separator className="my-2" />
            <Row label="DATA_DIR" value={effectivePairs[3]?.[1]} hint="本地数据目录（默认 server/data）" />
            <Row label="DB_PATH" value={effectivePairs[4]?.[1]} hint="SQLite 数据库文件路径" />
            <Row label="THUMB_DIR" value={effectivePairs[5]?.[1]} hint="缩略图目录" />
          </div>
        </div>
      </div>
    </div>
  );
}


