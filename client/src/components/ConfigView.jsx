import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { addScanRoot, clearLibraryByRoot, getConfig, setActiveScanRoot } from '../api/client';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';

function Row({ label, value }) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="text-gray-500">{label}</div>
      <div className="col-span-2 font-mono text-xs break-all text-gray-800">{value || '—'}</div>
    </div>
  );
}

export function ConfigView({ onScan, onAfterClear }) {
  "use no memo";
  const qc = useQueryClient();
  const [rootInput, setRootInput] = useState('');
  const [clearRoot, setClearRoot] = useState('');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [clearBusy, setClearBusy] = useState(false);

  const cfgQuery = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 5_000,
  });

  const scanRoots = cfgQuery.data?.scanRoots || [];
  const activeScanRoot = cfgQuery.data?.activeScanRoot || null;
  const effectiveScanRoot = cfgQuery.data?.effective?.scanRoot || null;

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

  const effective = cfgQuery.data?.effective || {};
  const effectivePairs = useMemo(() => {
    return [
      ['scanRoot', effective.scanRoot],
      ['WORK_ROOT', effective.WORK_ROOT],
      ['MANAGED_ROOT', effective.MANAGED_ROOT],
      ['TRASH_DIR', effective.TRASH_DIR],
      ['DATA_DIR', effective.DATA_DIR],
      ['DB_PATH', effective.DB_PATH],
      ['THUMB_DIR', effective.THUMB_DIR],
    ];
  }, [effective]);

  const onDryRun = async () => {
    const root = (clearRoot || '').trim();
    if (!root) return;
    setClearBusy(true);
    try {
      const r = await clearLibraryByRoot({ root, dryRun: true });
      setDryRunResult(r);
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
      onAfterClear?.();
      qc.invalidateQueries({ queryKey: ['config'] });
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div className="h-full w-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-3xl space-y-6">
        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">配置 & 扫描</div>
          <div className="text-sm text-gray-600 mt-1">
            当前生效扫描目录：
            <span className="ml-2 font-mono text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
              {effectiveScanRoot || '—'}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder="新增扫描目录（绝对路径）"
              />
              <Button
                disabled={!rootInput.trim() || addRootMutation.isPending}
                onClick={() => addRootMutation.mutate({ root: rootInput.trim(), setActive: true })}
                title="添加并设为当前"
              >
                添加并设为当前
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={!effectiveScanRoot || typeof onScan !== 'function'}
                onClick={() => onScan?.(effectiveScanRoot)}
              >
                开始扫描（当前目录）
              </Button>
              <div className="text-xs text-gray-500">
                activeScanRoot: <span className="font-mono">{activeScanRoot || '—'}</span>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="text-sm font-semibold text-gray-800 mb-2">扫描目录列表</div>
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
                      {isActive ? <div className="text-[11px] text-blue-600 mt-1">当前 active</div> : null}
                    </div>
                    <div className="shrink-0 flex gap-2">
                      <Button
                        variant={isActive ? 'secondary' : 'outline'}
                        size="sm"
                        disabled={isActive || setActiveMutation.isPending}
                        onClick={() => setActiveMutation.mutate({ root: r })}
                      >
                        设为当前
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              暂无自定义扫描目录。默认会使用 WORK_ROOT（通常是 Pictures）。
            </div>
          )}
        </div>

        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">清除某个目录的记录（仅清 DB）</div>
          <div className="text-sm text-gray-600 mt-1">
            只删除数据库中的记录（files/assets 等），不会删除磁盘上的照片文件。
          </div>

          <div className="mt-4 flex gap-2">
            <Input
              value={clearRoot}
              onChange={(e) => setClearRoot(e.target.value)}
              placeholder="要清理的目录（绝对路径）"
            />
            <Button variant="outline" disabled={!clearRoot.trim() || clearBusy} onClick={onDryRun}>
              预估（dry-run）
            </Button>
            <Button
              variant="destructive"
              disabled={!clearRoot.trim() || clearBusy}
              onClick={() => {
                const ok = window.confirm(`确认清除该目录的 DB 记录？\n${clearRoot.trim()}\n\n这不会删除磁盘文件，但会影响列表/归档/标签等关联数据。`);
                if (!ok) return;
                onConfirmClear();
              }}
            >
              执行清除
            </Button>
          </div>

          {dryRunResult ? (
            <div className="mt-4 rounded-lg border bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
              <div className="font-semibold">结果</div>
              <div>root: <span className="font-mono text-xs">{dryRunResult.root}</span></div>
              <div>dryRun: <span className="font-mono text-xs">{String(!!dryRunResult.dryRun)}</span></div>
              <div>matchedFiles: <span className="font-mono text-xs">{dryRunResult.matchedFiles}</span></div>
              <div>matchedHashes: <span className="font-mono text-xs">{dryRunResult.matchedHashes}</span></div>
              {dryRunResult.dryRun ? (
                <div>orphanHashesEstimate: <span className="font-mono text-xs">{dryRunResult.orphanHashesEstimate}</span></div>
              ) : (
                <>
                  <div>deletedFiles: <span className="font-mono text-xs">{dryRunResult.deletedFiles}</span></div>
                  <div>deletedAssets: <span className="font-mono text-xs">{dryRunResult.deletedAssets}</span></div>
                  <div>deletedAlbumLinks: <span className="font-mono text-xs">{dryRunResult.deletedAlbumLinks}</span></div>
                  <div>deletedTagLinks: <span className="font-mono text-xs">{dryRunResult.deletedTagLinks}</span></div>
                  <div>deletedOps: <span className="font-mono text-xs">{dryRunResult.deletedOps}</span></div>
                  <div>deletedChanges: <span className="font-mono text-xs">{dryRunResult.deletedChanges}</span></div>
                  <div>orphanHashes: <span className="font-mono text-xs">{dryRunResult.orphanHashes}</span></div>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="bg-white border rounded-xl p-5 shadow-sm">
          <div className="text-lg font-semibold text-gray-900">后端生效配置（只读）</div>
          <div className="mt-4 space-y-2">
            {effectivePairs.map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


