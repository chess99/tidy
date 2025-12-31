/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { FilterX, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPeople } from '../api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { DateRangePicker } from './ui/date-range-picker';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';

const COMMON_EXTS = ['mov', 'mp4', 'heic', 'jpg', 'png', 'gif', 'webp'];

function normExt(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('.')) s = s.slice(1);
  // keep it conservative; extensions like "3gp" etc are fine
  if (!/^[a-z0-9]{1,10}$/.test(s)) return null;
  return s;
}

export function FilesFilters({ value, onChange }) {
  "use no memo"
  const v = value || {};
  const [extInput, setExtInput] = useState('');
  const similarActive = v.similarKind === 'phash' && Number.isFinite(Number(v.similarToFileId));
  const similarSeedFileId = Number.isFinite(Number(v.similarToFileId)) ? Number(v.similarToFileId) : null;
  const similarThreshold = Number.isFinite(Number(v.similarThreshold))
    ? Math.max(0, Math.min(32, Math.floor(Number(v.similarThreshold))))
    : 10;

  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: getPeople,
    staleTime: 60000,
  });
  const people = peopleQuery.data || [];
  // Ensure selectedPeopleIds is array of numbers
  const selectedPeopleIds = useMemo(() => {
    if (!v.people) return [];
    const arr = Array.isArray(v.people) ? v.people : String(v.people).split(',');
    return arr.map(Number).filter(n => Number.isFinite(n));
  }, [v.people]);

  const rangeValue = useMemo(() => ({ from: v.from, to: v.to }), [v.from, v.to]);
  const selectedExts = Array.isArray(v.exts) ? v.exts : [];
  const selectedExtSet = new Set(selectedExts);

  const activeCount =
    (v.organized != null ? 1 : 0) +
    (v.hasDup ? 1 : 0) +
    (v.hasPeople ? 1 : 0) +
    (Number.isFinite(v.personCountMin) ? 1 : 0) +
    (Number.isFinite(v.personCountMax) ? 1 : 0) +
    (v.from ? 1 : 0) +
    (v.to ? 1 : 0) +
    (selectedExts.length ? 1 : 0) +
    (v.pathContains ? 1 : 0) +
    (selectedPeopleIds.length ? 1 : 0) +
    (v.hash ? 1 : 0) +
    (similarActive ? 1 : 0);

  const toggleExt = (raw) => {
    const e = normExt(raw);
    if (!e) return;
    const next = new Set(selectedExtSet);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    onChange({ ...v, exts: Array.from(next) });
  };

  const addExtFromInput = () => {
    const e = normExt(extInput);
    if (!e) return;
    if (selectedExtSet.has(e)) {
      setExtInput('');
      return;
    }
    onChange({ ...v, exts: [...selectedExts, e] });
    setExtInput('');
  };

  return (
    <div className="h-full w-80 shrink-0 border-r bg-background p-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">筛选</div>
        <div className="flex items-center gap-2">
          {activeCount ? <Badge variant="secondary">{activeCount}</Badge> : null}
          <Button
            variant="ghost"
            size="icon"
            title="清空筛选"
            onClick={() =>
              onChange({
                ...v,
                organized: undefined,
                hasDup: false,
                hasPeople: false,
                personCountMin: undefined,
                personCountMax: undefined,
                from: undefined,
                to: undefined,
                exts: [],
                people: undefined,
                pathContains: '',
                hash: '',
                similarKind: null,
                similarToFileId: null,
                similarThreshold: 10,
              })
            }
          >
            <FilterX className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">范围</div>
          <Select
            value={v.filter || 'all'}
            onValueChange={(filter) => onChange({ ...v, filter })}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择范围" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部文件</SelectItem>
              <SelectItem value="media">全部图片/视频</SelectItem>
              <SelectItem value="camera">相机照片/视频</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted-foreground">后缀（扩展名）</div>
            {/* Keep space reserved to avoid layout jump */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...v, exts: [] })}
              title="清空后缀筛选"
              className={selectedExts.length ? undefined : 'opacity-0 pointer-events-none'}
              aria-hidden={!selectedExts.length}
              tabIndex={selectedExts.length ? 0 : -1}
            >
              清空
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {COMMON_EXTS.map((e) => {
              const on = selectedExtSet.has(e);
              return (
                <Button
                  key={e}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleExt(e)}
                  title={`筛选 .${e}`}
                >
                  .{e}
                </Button>
              );
            })}
          </div>

          {selectedExts.length ? (
            <div className="flex flex-wrap gap-2">
              {selectedExts.map((e) => (
                <Badge key={e} variant="secondary" className="gap-1">
                  .{e}
                  <button
                    type="button"
                    className="ml-1 rounded hover:opacity-80"
                    title={`移除 .${e}`}
                    onClick={() => toggleExt(e)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Input
              value={extInput}
              onChange={(e) => setExtInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addExtFromInput();
                }
              }}
              placeholder="自定义：mov / .mov"
            />
            <Button type="button" variant="outline" size="icon" title="添加后缀" onClick={addExtFromInput}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground leading-4">
            提示：后缀筛选会与“范围”叠加；若无结果可切回
            <button
              type="button"
              className="ml-1 underline underline-offset-2"
              onClick={() => onChange({ ...v, filter: 'all' })}
              title="切回 全部文件"
            >
              全部文件
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">人物 ({selectedPeopleIds.length})</div>
          {selectedPeopleIds.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedPeopleIds.map((id) => {
                const p = people.find((x) => x.id === id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {p ? p.name : `ID:${id}`}
                    <button
                      type="button"
                      className="ml-1 rounded hover:opacity-80"
                      onClick={() => {
                        const next = selectedPeopleIds.filter((pid) => pid !== id);
                        onChange({ ...v, people: next.length ? next : undefined });
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 text-xs text-muted-foreground"
                onClick={() => onChange({ ...v, people: undefined })}
              >
                清空
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">未选择（在详情面板添加）</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">有人 / 人数</div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={!!v.hasPeople}
              onCheckedChange={(ck) => onChange({ ...v, hasPeople: !!ck })}
            />
            <span>仅有人脸（已识别/已聚类后）</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">人数 ≥</div>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={Number.isFinite(v.personCountMin) ? String(v.personCountMin) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) return onChange({ ...v, personCountMin: undefined });
                  const n = Number(raw);
                  onChange({ ...v, personCountMin: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : undefined });
                }}
                placeholder="例如：1"
              />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">人数 ≤</div>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={Number.isFinite(v.personCountMax) ? String(v.personCountMax) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) return onChange({ ...v, personCountMax: undefined });
                  const n = Number(raw);
                  onChange({ ...v, personCountMax: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : undefined });
                }}
                placeholder="例如：2"
              />
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground leading-4">
            提示：人数按同一张照片里的“不同 person”计数；用于筛“合照”（例如 ≥2）。
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">状态</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.organized === 0}
                onCheckedChange={(ck) =>
                  onChange({ ...v, organized: ck ? 0 : undefined })
                }
              />
              <span>仅未整理</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.organized === 1}
                onCheckedChange={(ck) =>
                  onChange({ ...v, organized: ck ? 1 : undefined })
                }
              />
              <span>仅已整理</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!v.hasDup}
                onCheckedChange={(ck) => onChange({ ...v, hasDup: !!ck })}
              />
              <span>仅重复</span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">日期</div>
          <DateRangePicker
            value={rangeValue}
            onChange={(r) => onChange({ ...v, from: r.from, to: r.to })}
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">路径包含</div>
          <div className="relative">
            <Input
              value={v.pathContains || ''}
              onChange={(e) => onChange({ ...v, pathContains: e.target.value })}
              placeholder="例如：\\DCIM\\ 或 \\YYYYMMDD-Trip\\"
              className={v.pathContains ? 'pr-9' : undefined}
            />
            {v.pathContains ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                title="清空路径筛选"
                onClick={() => onChange({ ...v, pathContains: '' })}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Hash 精确</div>
          <div className="relative">
            <Input
              value={v.hash || ''}
              onChange={(e) => onChange({ ...v, hash: e.target.value.trim() })}
              placeholder="用于“仅看该内容”排查重复"
              className={v.hash ? 'pr-9' : undefined}
            />
            {v.hash ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                title="清空 hash 筛选"
                onClick={() => onChange({ ...v, hash: '' })}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">相似（pHash）</div>
          {similarActive ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  seed file_id：<span className="font-mono">{String(similarSeedFileId)}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...v, similarKind: null, similarToFileId: null })}
                  title="清除相似筛选"
                >
                  清除
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={32}
                  value={similarThreshold}
                  onChange={(e) => onChange({ ...v, similarThreshold: Number(e.target.value) || 0 })}
                  className="w-full"
                />
                <div className="text-xs font-semibold tabular-nums w-7 text-right">{similarThreshold}</div>
              </div>

              <div className="text-[11px] text-muted-foreground leading-4">
                阈值越小越相似（0=完全一致，32=最宽松）。
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">未开启（在详情面板点“找相似”）</div>
          )}
        </div>
      </div>
    </div>
  );
}


