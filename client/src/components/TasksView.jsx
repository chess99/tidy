import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Settings2 } from 'lucide-react';
import { createJob, listJobs } from '../api/client';
import { Button } from './ui/button';

function TaskCard({ title, desc, type, onJumpSettings }) {
  const qc = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: ['jobs', 'byType', type],
    queryFn: () => listJobs({ limit: 200, type }),
    refetchInterval: 1000,
  });

  const jobs = jobsQuery.data?.data || [];
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;

  const startMutation = useMutation({
    mutationFn: ({ mode, params }) => createJob({ type, mode, params }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  return (
    <div className="bg-white border rounded-xl p-5 shadow-sm flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-lg font-semibold text-gray-900">{title}</div>
        <div className="text-sm text-gray-600 mt-1 leading-6">{desc}</div>
        <div className="mt-3 text-xs text-gray-500 tabular-nums">
          运行中 {running} · 排队 {queued}
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate({ mode: 'missing', params: {} })}
            title="只补扫缺失/未完成项"
          >
            {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            缺失/补扫
          </Button>
          <Button
            disabled={startMutation.isPending}
            onClick={() => startMutation.mutate({ mode: 'all', params: {} })}
            title="全量运行（仍会尽量跳过已完成项）"
          >
            {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            全部
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onJumpSettings?.()} title="跳转到相关设置">
          <Settings2 className="mr-2 h-4 w-4" />
          管理设置
        </Button>
      </div>
    </div>
  );
}

export function TasksView({ onJumpSettings }) {
  return (
    <div className="h-full w-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-4xl space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">任务队列</div>
            <div className="text-sm text-gray-600 mt-1">
              以任务为中心统一触发与观察：扫描（发现文件）→ 补全入库 → 缩略图/人脸等增补；支持“全部/缺失补扫”。
            </div>
          </div>
        </div>

        <TaskCard
          title="扫描文件（Discover）"
          type="discover"
          desc="从已启用的扫描目录中发现文件并写入 files 表；会应用类型过滤、排除规则、最小文件大小。"
          onJumpSettings={() => onJumpSettings?.('scan')}
        />

        <TaskCard
          title="补全入库（Enrich）"
          type="enrich"
          desc="对已发现的文件计算 hash、提取元数据并生成缩略图（best-effort）。"
          onJumpSettings={() => onJumpSettings?.('concurrency')}
        />

        <TaskCard
          title="重建缩略图"
          type="thumbs_rebuild"
          desc="重建全库缩略图（all 会强制重建；missing 仅补齐缺失）。"
          onJumpSettings={() => onJumpSettings?.('concurrency')}
        />

        <TaskCard
          title="人脸检测（入库）"
          type="faces_scan"
          desc="为图片资产检测人脸并写入 faces 表（缺失补扫默认只扫未扫/无 faces 的）。"
          onJumpSettings={() => onJumpSettings?.('concurrency')}
        />

        <TaskCard
          title="人脸重聚类（维护）"
          type="faces_recluster"
          desc="按当前 faces.descriptor 进行聚类生成 people，并写回 faces.person_id。"
          onJumpSettings={() => onJumpSettings?.('faces')}
        />

        <TaskCard
          title="同步变更（对账/恢复）"
          type="sync"
          desc="重放 pending file_ops，并处理遗留 trash 标记（用于崩溃恢复与一致性对账）。"
          onJumpSettings={() => onJumpSettings?.('sync')}
        />

        <TaskCard
          title="CLIP（预留）"
          type="clip"
          desc="将来用于语义检索/自动标签（当前未实现，占位）。"
          onJumpSettings={() => onJumpSettings?.('ai')}
        />

        <TaskCard
          title="OCR（预留）"
          type="ocr"
          desc="将来用于文本识别与检索（当前未实现，占位）。"
          onJumpSettings={() => onJumpSettings?.('ai')}
        />
      </div>
    </div>
  );
}


