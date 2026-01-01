/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, RotateCcw, X } from 'lucide-react';
import { useMemo } from 'react';
import { cancelJob, createJob, listJobs, retryJob } from '../api/client';
import { Button } from './ui/button';

function fmtProgress(job) {
  if (!job) return null;
  const phase = job?.progress?.phase ? String(job.progress.phase) : null;
  const processed = Number.isFinite(job?.progress?.processed) ? job.progress.processed : null;
  const total = Number.isFinite(job?.progress?.total) ? job.progress.total : null;
  const parts = [];
  if (phase) parts.push(phase);
  if (processed != null || total != null) parts.push(`${processed ?? '—'}${total != null ? ` / ${total}` : ''}`);
  return parts.length ? parts.join(' · ') : null;
}

function TaskStatusBar({ statusLabel, accentClass, runningCount, queuedCount, progressText }) {
  return (
    <div className={`px-5 py-3 border-b flex items-center justify-between gap-3 ${accentClass}`}>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-gray-800">{statusLabel}</div>
        {progressText ? <div className="text-[11px] text-gray-600 mt-0.5 truncate">{progressText}</div> : null}
      </div>
      <div className="shrink-0 flex items-center gap-2 text-xs tabular-nums">
        <span className="px-2 py-1 rounded-lg bg-white/70 border border-white/40 text-gray-800">
          正在处理 <span className="font-semibold">{runningCount}</span>
        </span>
        <span className="px-2 py-1 rounded-lg bg-white/70 border border-white/40 text-gray-800">
          准备处理 <span className="font-semibold">{queuedCount}</span>
        </span>
      </div>
    </div>
  );
}

const TASK_DEFS = [
  {
    type: 'discover',
    title: '扫描文件（Discover）',
    desc: '从已启用的扫描目录中发现文件并写入 files 表；会应用类型过滤、排除规则、最小文件大小。',
    actions: [
      { label: '缺失/补扫', mode: 'missing', variant: 'outline', title: '只补扫缺失/未完成项' },
      { label: '全部', mode: 'all', variant: 'default', title: '全量运行（仍会尽量跳过已完成项）' },
    ],
    settingsAnchor: 'scan',
  },
  {
    type: 'enrich',
    title: '补全入库（Enrich）',
    desc: '对已发现的文件计算 hash、提取元数据并生成缩略图（best-effort）。',
    actions: [
      { label: '缺失/补扫', mode: 'missing', variant: 'outline', title: '只补齐缺失/未完成项' },
      { label: '全部', mode: 'all', variant: 'default', title: '全量运行（仍会尽量跳过已完成项）' },
    ],
    settingsAnchor: 'concurrency',
  },
  {
    type: 'thumbs_rebuild',
    title: '重建缩略图',
    desc: '重建全库缩略图（all 会强制重建；missing 仅补齐缺失）。',
    actions: [
      { label: '缺失/补扫', mode: 'missing', variant: 'outline', title: '只补齐缺失缩略图' },
      { label: '全部', mode: 'all', variant: 'default', title: '强制重建全库缩略图' },
    ],
    settingsAnchor: 'concurrency',
  },
  {
    type: 'faces_scan',
    title: '人脸检测（入库）',
    desc: '为图片资产检测人脸并写入 faces 表（missing 默认只扫未扫/无 faces 的）。',
    actions: [
      { label: '缺失/补扫', mode: 'missing', variant: 'outline', title: '只补扫缺失人脸数据' },
      { label: '全部', mode: 'all', variant: 'default', title: '全量重新检测（可能耗时很久）' },
    ],
    settingsAnchor: 'concurrency',
  },
  {
    type: 'clip_enrich',
    title: 'CLIP Embedding（入库）',
    desc: '为图片补算 CLIP embedding（写入 clip_embeddings），用于“智能搜索/相似(CLIP)”。',
    actions: [
      { label: '缺失/补扫', mode: 'missing', variant: 'outline', title: '只补算缺失 embedding' },
      { label: '全部', mode: 'all', variant: 'default', title: '全量重算 embedding（模型切换/校准后用）' },
    ],
    settingsAnchor: 'concurrency',
  },
  {
    type: 'clip_index',
    title: 'CLIP 索引（HNSW）',
    desc: '重建向量近邻索引文件（server/data/index/clip_hnsw.bin），用于毫秒级检索。',
    actions: [{ label: '重建', mode: 'rebuild', variant: 'default', title: '从 clip_embeddings 重建索引' }],
    settingsAnchor: null,
  },
  {
    type: 'faces_recluster',
    title: '人脸重聚类（维护）',
    desc: '按当前 faces.descriptor 进行聚类生成 people，并写回 faces.person_id。',
    actions: [{ label: '开始', mode: 'all', variant: 'default', title: '开始重聚类' }],
    settingsAnchor: 'faces',
  },
  {
    type: 'sync',
    title: '同步变更（对账/恢复）',
    desc: '重放 pending file_ops，并处理遗留 trash 标记（用于崩溃恢复与一致性对账）。',
    actions: [{ label: '开始', mode: 'all', variant: 'default', title: '开始对账/恢复' }],
    settingsAnchor: 'sync',
  },
];

function TaskCardImmich({ def, jobs, onCreate, onCancel, onRetry, pending, onJumpSettings }) {
  const type = def.type;
  const typeJobs = jobs.filter((j) => j.type === type);
  const runningCount = typeJobs.filter((j) => j.status === 'running').length;
  const queuedCount = typeJobs.filter((j) => j.status === 'queued').length;
  const active = typeJobs.find((j) => j.status === 'running') || typeJobs.find((j) => j.status === 'queued') || null;
  const failed = typeJobs.find((j) => j.status === 'failed' || j.status === 'interrupted') || null;

  const statusLabel =
    active?.status === 'running'
      ? '正在处理'
      : active?.status === 'queued'
        ? '准备处理'
        : failed
          ? '上次失败'
          : '空闲';

  const accentClass =
    active?.status === 'running'
      ? 'bg-blue-50'
      : active?.status === 'queued'
        ? 'bg-gray-50'
        : failed
          ? 'bg-red-50'
          : 'bg-green-50';

  const progressText = fmtProgress(active) || (failed?.last_error ? String(failed.last_error) : null);

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <TaskStatusBar
        statusLabel={statusLabel}
        accentClass={accentClass}
        runningCount={runningCount}
        queuedCount={queuedCount}
        progressText={progressText}
      />

      <div className="p-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-gray-900">{def.title}</div>
          <div className="text-sm text-gray-600 mt-1 leading-6">{def.desc}</div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex gap-2 flex-wrap justify-end">
            {def.actions.map((a) => (
              <Button
                key={`${type}:${a.mode}:${a.label}`}
                variant={a.variant || 'default'}
                disabled={pending}
                onClick={() => onCreate?.({ type, mode: a.mode, params: {} })}
                title={a.title || ''}
              >
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {a.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs text-gray-600">
            {def.settingsAnchor ? (
              <button
                type="button"
                className="hover:text-gray-900 underline-offset-2 hover:underline"
                onClick={() => onJumpSettings?.(def.settingsAnchor)}
              >
                查看相关配置
              </button>
            ) : null}

            {active && (active.status === 'running' || active.status === 'queued') ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-gray-900"
                disabled={pending}
                onClick={() => {
                  const ok = window.confirm(`取消任务？\n${active.type} · ${active.mode}`);
                  if (!ok) return;
                  onCancel?.(active.id);
                }}
                title="取消当前任务"
              >
                <X size={14} />
                取消
              </button>
            ) : null}

            {failed ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-gray-900"
                disabled={pending}
                onClick={() => onRetry?.(failed.id)}
                title="以相同参数重试"
              >
                <RotateCcw size={14} />
                重试
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TasksView({ onJumpSettings, embedded = false }) {
  const qc = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: ['jobs', 'admin'],
    queryFn: () => listJobs({ limit: 200 }),
    refetchInterval: 1000,
  });
  const jobs = useMemo(() => jobsQuery.data?.data || [], [jobsQuery.data]);

  const createMutation = useMutation({
    mutationFn: ({ type, mode, params }) => createJob({ type, mode, params }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const cancelMutation = useMutation({
    mutationFn: (id) => cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
  const retryMutation = useMutation({
    mutationFn: (id) => retryJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const pending = createMutation.isPending || cancelMutation.isPending || retryMutation.isPending;

  return (
    <div className={embedded ? 'min-h-full p-6' : 'h-full w-full overflow-auto bg-gray-50 p-6'}>
      <div className={embedded ? 'space-y-4' : 'max-w-4xl space-y-4'}>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">任务队列</div>
            <div className="text-sm text-gray-600 mt-1">
              先配置扫描规则与并发，再按任务触发：Discover → Enrich → Thumbs/Faces/CLIP → Sync。
            </div>
          </div>
        </div>

        {TASK_DEFS.map((def) => (
          <TaskCardImmich
            key={def.type}
            def={def}
            jobs={jobs}
            pending={pending}
            onCreate={({ type, mode, params }) => createMutation.mutate({ type, mode, params })}
            onCancel={(id) => cancelMutation.mutate(id)}
            onRetry={(id) => retryMutation.mutate(id)}
            onJumpSettings={onJumpSettings}
          />
        ))}
      </div>
    </div>
  );
}


