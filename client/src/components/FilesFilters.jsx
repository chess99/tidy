import { X } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { DateRangePicker } from './ui/date-range-picker';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';

export function FilesFilters({ value, onChange }) {
  const v = value || {};

  const rangeValue = useMemo(() => ({ from: v.from, to: v.to }), [v.from, v.to]);

  const activeCount =
    (v.organized != null ? 1 : 0) +
    (v.hasDup ? 1 : 0) +
    (v.from ? 1 : 0) +
    (v.to ? 1 : 0) +
    (v.pathContains ? 1 : 0) +
    (v.hash ? 1 : 0);

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
                from: undefined,
                to: undefined,
                pathContains: '',
                hash: '',
              })
            }
          >
            <X className="h-4 w-4" />
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
              placeholder="例如：\\20100609 高中最后一天\\"
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
      </div>
    </div>
  );
}


