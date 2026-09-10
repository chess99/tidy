/**
 * input: props + API 数据 + 本地状态
 * output: 含文字/临时参考图智能搜索的筛选面板
 * pos: 客户端视图层：统一搜索与筛选交互（变更需同步更新本头注释与所属目录 README）
 */

import { Search, X, Filter, Image, Video, Calendar, Users, Folder, Hash, Sparkles, Trash2, CheckCircle2, ImagePlus, Type, LoaderCircle, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createImageSearch, deleteImageSearch, getPeople } from '../api/client';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DateFilterPicker } from './ui/date-filter-picker';

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
  const [searchMode, setSearchMode] = useState(() => (v.imageSearchId ? 'image' : 'text'));
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [imageName, setImageName] = useState(() => String(v.imageSearchName || ''));
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageInputRef = useRef(null);
  const imagePreviewUrlRef = useRef('');
  const uploadSequenceRef = useRef(0);

  useEffect(() => () => {
    uploadSequenceRef.current += 1;
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
  }, []);

  const releaseImagePreview = () => {
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    imagePreviewUrlRef.current = '';
    setImagePreviewUrl('');
  };

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
    v.imageSearchId,
    v.from || v.to,
    selectedExts.length > 0,
    selectedPeopleIds.length > 0,
    v.hasPeople,
    v.status,
    v.hasDup,
    v.pathContains,
    v.hash,
    (v.similarKind === 'phash' || v.similarKind === 'clip') && v.similarToFileId,
  ].filter(Boolean).length;

  const clearAll = () => {
    uploadSequenceRef.current += 1;
    if (v.imageSearchId) deleteImageSearch(v.imageSearchId).catch(() => {});
    setSmartInput('');
    releaseImagePreview();
    setImageName('');
    setImageError('');
    setImageUploading(false);
    onChange({
      smartQuery: '',
      imageSearchId: undefined,
      imageSearchName: undefined,
      from: undefined,
      to: undefined,
      exts: [],
      people: undefined,
      hasPeople: false,
      status: undefined,
      hasDup: false,
      pathContains: '',
      hash: '',
      similarKind: null,
      similarToFileId: null,
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
    const query = smartInput.trim();
    if (!query) return;
    uploadSequenceRef.current += 1;
    if (v.imageSearchId) deleteImageSearch(v.imageSearchId).catch(() => {});
    releaseImagePreview();
    setImageName('');
    setImageUploading(false);
    setImageError('');
    onChange({
      ...v,
      smartQuery: query,
      imageSearchId: undefined,
      imageSearchName: undefined,
      similarKind: null,
      similarToFileId: null,
    });
  };

  const clearImageSearch = () => {
    uploadSequenceRef.current += 1;
    if (v.imageSearchId) deleteImageSearch(v.imageSearchId).catch(() => {});
    releaseImagePreview();
    setImageName('');
    setImageError('');
    setImageUploading(false);
    onChange({
      ...v,
      imageSearchId: undefined,
      imageSearchName: undefined,
    });
  };

  const processReferenceImage = async (file) => {
    if (!file) return;
    const looksLikeImage = String(file.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(file.name || '');
    if (!looksLikeImage) {
      setImageError('请选择图片文件。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setImageError('图片不能超过 20 MB。');
      return;
    }

    const sequence = uploadSequenceRef.current + 1;
    uploadSequenceRef.current = sequence;
    const nextPreviewUrl = URL.createObjectURL(file);
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    imagePreviewUrlRef.current = nextPreviewUrl;
    setImagePreviewUrl(nextPreviewUrl);
    setImageName(file.name || '参考图');
    setImageError('');
    setImageUploading(true);

    try {
      const result = await createImageSearch(file);
      if (uploadSequenceRef.current !== sequence) {
        deleteImageSearch(result?.imageSearchId).catch(() => {});
        return;
      }
      if (v.imageSearchId && v.imageSearchId !== result.imageSearchId) {
        deleteImageSearch(v.imageSearchId).catch(() => {});
      }
      setSmartInput('');
      onChange({
        ...v,
        smartQuery: '',
        imageSearchId: result.imageSearchId,
        imageSearchName: file.name || '参考图',
        similarKind: null,
        similarToFileId: null,
      });
    } catch (error) {
      if (uploadSequenceRef.current !== sequence) return;
      const message = error?.response?.data?.error || '无法使用这张图片，请换一张再试。';
      setImageError(String(message));
      if (v.imageSearchId) {
        releaseImagePreview();
        setImageName(String(v.imageSearchName || ''));
      }
    } finally {
      if (uploadSequenceRef.current === sequence) setImageUploading(false);
    }
  };

  const pickPastedImage = (event) => {
    const item = Array.from(event.clipboardData?.items || []).find((candidate) => candidate.type?.startsWith('image/'));
    const file = item?.getAsFile?.();
    if (!file) return;
    event.preventDefault();
    processReferenceImage(file);
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
        <div className="p-4 border-b" onPaste={searchMode === 'image' ? pickPastedImage : undefined}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-blue-500" />
              智能搜索
            </div>
            <div className="inline-flex rounded-md bg-gray-100 p-0.5" role="tablist" aria-label="智能搜索方式">
              <button
                type="button"
                role="tab"
                aria-selected={searchMode === 'text'}
                onClick={() => setSearchMode('text')}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${searchMode === 'text' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Type className="h-3 w-3" />
                文字
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={searchMode === 'image'}
                onClick={() => setSearchMode('image')}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${searchMode === 'image' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <ImagePlus className="h-3 w-3" />
                图片
              </button>
            </div>
          </div>

          {searchMode === 'text' ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={smartInput}
                onChange={(e) => setSmartInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySmartSearch()}
                placeholder={isClipSimilarActive ? '语义相似筛选中...' : '描述想找的画面...'}
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
          ) : (
            <button
              type="button"
              disabled={imageUploading}
              onClick={() => imageInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(event) => {
                event.preventDefault();
                processReferenceImage(event.dataTransfer.files?.[0]);
              }}
              className="group w-full min-h-20 overflow-hidden rounded-lg border border-dashed border-blue-200 bg-blue-50/50 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait"
            >
              {(imagePreviewUrl || v.imageSearchId) ? (
                <div className="flex items-center gap-3 p-2.5">
                  {imagePreviewUrl ? (
                    <img src={imagePreviewUrl} alt="临时参考图预览" className="h-14 w-14 shrink-0 rounded-md object-cover bg-white" />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-md bg-blue-100 flex items-center justify-center">
                      <ImagePlus className="h-6 w-6 text-blue-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-gray-800">{imageName || v.imageSearchName || '临时参考图'}</div>
                    <div className="mt-1 text-[11px] text-blue-600">
                      {imageUploading ? '正在理解图片…' : '点击、拖放或粘贴可换图'}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500">只用于本次搜索，不会加入图库</div>
                  </div>
                  {imageUploading ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-blue-500" /> : <Upload className="h-4 w-4 shrink-0 text-blue-400 opacity-0 group-hover:opacity-100" />}
                </div>
              ) : (
                <div className="flex min-h-20 flex-col items-center justify-center px-3 py-3 text-center">
                  {imageUploading ? <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" /> : <ImagePlus className="h-5 w-5 text-blue-500" />}
                  <div className="mt-1.5 text-xs font-medium text-gray-700">选择、拖放或粘贴参考图</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">不入库 · 最大 20 MB</div>
                </div>
              )}
            </button>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={(event) => {
              processReferenceImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          {imageError ? (
            <div role="alert" className="mt-2 text-[11px] leading-4 text-red-600">{imageError}</div>
          ) : null}

          {v.smartQuery && (
            <div className="flex items-center gap-2 mt-2">
              <Badge className="max-w-[210px] truncate bg-blue-100 text-blue-700 text-xs" title={v.smartQuery}>
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

          {v.imageSearchId && (
            <div className="flex items-center gap-2 mt-2">
              <Badge className="max-w-[210px] gap-1.5 truncate bg-indigo-100 text-indigo-700 text-xs" title={v.imageSearchName || '临时参考图'}>
                <ImagePlus className="h-3 w-3 shrink-0" />
                <span className="truncate">以图搜图：{v.imageSearchName || '参考图'}</span>
              </Badge>
              <button
                type="button"
                aria-label="清除以图搜图"
                onClick={clearImageSearch}
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

        {/* Date filters */}
        <div className="p-4 border-b">
          <div className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            日期
          </div>
          <div className="min-w-0">
            <DateFilterPicker
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
