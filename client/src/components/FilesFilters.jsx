/**
 * input: props + API 数据 + 本地状态
 * output: 美观易用的筛选面板
 * pos: 客户端视图层：重新设计的筛选面板（变更需同步更新本头注释与所属目录 README）
 */

import { Search, X, Filter, Image, Video, Calendar, Users, Folder, Hash, Sparkles, Trash2, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPeople } from '../api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DateRangePicker } from './ui/date-range-picker';

const FILE_TYPE_GROUPS = [
  { key: 'image', label: '图片', icon: Image, exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'] },
  { key: 'raw', label: 'RAW', icon: Image, exts: ['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'rw2', 'orf', 'sr2', 'pef'] },
  { key: 'video', label: '视频', icon: Video, exts: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'] },
];

const STATUS_OPTIONS = [
  { key: 'inbox', label: '未整理' },
  { key: 'sorted', label: '已保留' },
  { key: 'trash', label: '已删除' },
];

export function FilesFilters({ value, onChange }) {
  const v = value || {};
  const [smartInput, setSmartInput] = useState(() => String(v.smartQuery || ''));

  // 语义相似和智能搜索冲突：当有语义相似筛选时，禁用智能搜索
  const isClipSimilarActive = v.similarKind === 'clip' && v.similarToFileId;

  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: getPeople,
    staleTime: 60000,
  });
  const people = peopleQuery.data || [];

  const selectedPeopleIds = useMemo(() => {
    if (!v.people) return [];
    const arr = Array.isArray(v.people) ? v.people : String(v.people).split(',');
    return arr.map(Number).filter(n => Number.isFinite(n));
  }, [v.people]);

  const selectedExts = Array.isArray(v.exts) ? v.exts : [];

  // 计算激活的筛选条件数
  const activeFilters = [
    v.smartQuery,
    v.from || v.to,
    selectedExts.length > 0,
    selectedPeopleIds.length > 0,
    v.hasPeople,
    v.status,
    v.hasDup,
    v.pathContains,
    v.hash,
  ].filter(Boolean).length;

  const clearAll = () => {
    setSmartInput('');
    onChange({
      smartQuery: '',
      from: undefined,
      to: undefined,
      exts: [],
      people: undefined,
      hasPeople: false,
      status: undefined,
      hasDup: false,
      pathContains: '',
      hash: '',
    });
  };

  const toggleExtGroup = (group) => {
    const groupExts = group.exts;
    const allSelected = groupExts.every(e => selectedExts.includes(e));
    const next = allSelected
      ? selectedExts.filter(e => !groupExts.includes(e))
      : [...new Set([...selectedExts, ...groupExts])];
    onChange({ ...v, exts: next });
  };

  const isGroupActive = (group) => {
    return group.exts.some(e => selectedExts.includes(e));
  };

  const applySmartSearch = () => {
    onChange({ ...v, smartQuery: smartInput.trim() });
  };

  return (
    <div className="h-full w-72 shrink-0 border-r bg-white flex flex-col">
      {/* Header - 固定高度防止跳动 */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 h-12">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900">筛选</span>
          {activeFilters > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {activeFilters}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 text-xs ${activeFilters > 0 ? 'visible' : 'invisible'}`}
          onClick={clearAll}
        >
          清空
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Smart Search */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={smartInput}
              onChange={(e) => setSmartInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySmartSearch()}
              placeholder={isClipSimilarActive ? '语义相似筛选中...' : '智能搜索...'}
              disabled={isClipSimilarActive}
              className={`w-full pl-9 pr-16 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${isClipSimilarActive ? 'bg-gray-100 text-gray-500' : ''}`}
            />
            <Button
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-xs"
              disabled={!smartInput.trim() || smartInput.trim() === v.smartQuery || isClipSimilarActive}
              onClick={applySmartSearch}
            >
              搜索
            </Button>
          </div>

          {/* Smart Query Tag */}
          {v.smartQuery && (
            <div className="flex items-center gap-2 mt-2">
              <Badge className="bg-blue-100 text-blue-700 text-xs">
                {v.smartQuery}
              </Badge>
              <button
                onClick={() => { setSmartInput(''); onChange({ ...v, smartQuery: '' }); }}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Similar Filter Indicator - moved here */}
          {(v.similarKind === 'phash' || v.similarKind === 'clip') && v.similarToFileId && (
            <div className="flex items-center gap-2 mt-2">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                <Sparkles className="h-3 w-3" />
                {v.similarKind === 'phash' ? '相似图' : '语义相似'}
              </div>
              <button
                onClick={() => onChange({ ...v, similarKind: null, similarToFileId: null })}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* File Types */}
        <div className="p-4 border-b">
          <div className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Image className="h-3.5 w-3.5" />
            文件类型
          </div>
          <div className="flex flex-wrap gap-2">
            {FILE_TYPE_GROUPS.map((group) => {
              const Icon = group.icon;
              const active = isGroupActive(group);
              return (
                <button
                  key={group.key}
                  onClick={() => toggleExtGroup(group)}
                  className={`
                    inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer
                    ${active
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                    }
                  `}
                >
                  <Icon className="h-3 w-3" />
                  {group.label}
                  {active && <span className="text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>
          {selectedExts.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              已选: {selectedExts.map(e => `.${e}`).join(', ')}
            </div>
          )}
        </div>

        {/* Date Range - 使用 min-w-0 防止撑大 */}
        <div className="p-4 border-b">
          <div className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            日期
          </div>
          <div className="min-w-0">
            <DateRangePicker
              value={{ from: v.from, to: v.to }}
              onChange={(range) => onChange({ ...v, from: range?.from, to: range?.to })}
            />
          </div>
        </div>

        {/* Quick Filters */}
        <div className="p-4 border-b">
          <div className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            快速筛选
          </div>
          <div className="space-y-3">
            {/* Status - 统一选中样式 */}
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => onChange({ ...v, status: v.status === opt.key ? undefined : opt.key })}
                  className={`
                    px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer
                    ${v.status === opt.key
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Path filter - 移出高级筛选 */}
            <div>
              <div className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                <Folder className="h-3 w-3" />
                路径包含
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={v.pathContains || ''}
                  onChange={(e) => onChange({ ...v, pathContains: e.target.value })}
                  placeholder="例如: 2024-旅行 或文件名"
                  className="w-full px-2.5 pr-7 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {v.pathContains && (
                  <button
                    onClick={() => onChange({ ...v, pathContains: '' })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Other quick filters */}
            <div className="flex flex-wrap gap-3 pt-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                <input
                  type="checkbox"
                  checked={!!v.hasDup}
                  onChange={(e) => onChange({ ...v, hasDup: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600"
                />
                仅重复
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                <input
                  type="checkbox"
                  checked={!!v.hasPeople}
                  onChange={(e) => onChange({ ...v, hasPeople: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600"
                />
                含人物
              </label>
            </div>
          </div>
        </div>

        {/* People - 包含人数范围 */}
        {people.length > 0 && (
          <div className="p-4 border-b">
            <div className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              人物
              {selectedPeopleIds.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  {selectedPeopleIds.length}
                </Badge>
              )}
            </div>

            {/* Person count range */}
            <div className="mb-3">
              <div className="text-[11px] font-medium text-gray-500 mb-1.5">人数范围</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  placeholder="最小"
                  value={v.personCountMin || ''}
                  onChange={(e) => onChange({ ...v, personCountMin: e.target.value ? parseInt(e.target.value) : undefined })}
                  className="w-16 px-2 py-1 text-xs border rounded-md"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  min={1}
                  placeholder="最大"
                  value={v.personCountMax || ''}
                  onChange={(e) => onChange({ ...v, personCountMax: e.target.value ? parseInt(e.target.value) : undefined })}
                  className="w-16 px-2 py-1 text-xs border rounded-md"
                />
              </div>
            </div>

            {/* People tags */}
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {people.map((p) => {
                const active = selectedPeopleIds.includes(p.id);
                // 兜底显示：没有名字时显示 ID:xx
                const displayName = p.name?.trim() || `ID:${p.id}`;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      const next = active
                        ? selectedPeopleIds.filter(id => id !== p.id)
                        : [...selectedPeopleIds, p.id];
                      onChange({ ...v, people: next.length ? next : undefined });
                    }}
                    className={`
                      px-2.5 py-1 rounded-full text-xs transition-colors cursor-pointer
                      ${active
                        ? 'bg-blue-100 text-blue-700 border border-blue-200'
                        : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                      }
                    `}
                  >
                    {displayName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Hash filter - 直接显示，不再折叠 */}
        <div className="p-4 border-b">
          <div className="text-[11px] font-medium text-gray-500 mb-1.5 flex items-center gap-1">
            <Hash className="h-3 w-3" />
            Hash 精确匹配
          </div>
          <div className="relative">
            <input
              type="text"
              value={v.hash || ''}
              onChange={(e) => onChange({ ...v, hash: e.target.value })}
              placeholder="输入文件哈希"
              className="w-full px-2.5 pr-7 py-1.5 text-xs border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            {v.hash && (
              <button
                onClick={() => onChange({ ...v, hash: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-3 border-t bg-gray-50 text-[10px] text-gray-500 text-center">
        提示: 多个筛选条件会叠加生效
      </div>
    </div>
  );
}
