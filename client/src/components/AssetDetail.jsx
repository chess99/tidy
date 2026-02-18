/**
 * input: selectedAsset + API 数据
 * output: 美观且功能完整的详情面板
 * pos: 客户端视图层：美观的详情面板，支持各种筛选联动（变更需同步更新本头注释与所属目录 README）
 */

import {
  X, FolderOpen, Maximize2, Calendar, Camera, Hash, FileType, HardDrive, Users, Sparkles,
  Image as ImageIcon, Trash2, FolderSearch
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { apiUrl, openFileLocation } from '../api/client';
import { useState } from 'react';
import { AssetFacesPanel } from './AssetFacesPanel';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dirPrefixOf(filePath) {
  if (!filePath) return '';
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSep > 0 ? filePath.slice(0, lastSep) : '';
}

function InfoRow({ icon: Icon, label, value, children }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-gray-400">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        {value && <div className="text-sm text-gray-900">{value}</div>}
        {children}
      </div>
    </div>
  );
}

export function AssetDetail({
  asset,
  onClose,
  onOpenViewer,
  onApplyFilter,
  onApplySimilarPhash,
  onApplySimilarClip,
  onStatusChange,
  onFilterByPerson
}) {
  const [thumbError, setThumbError] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);

  if (!asset) return null;

  const isVideo = String(asset.mime_type || '').toLowerCase().startsWith('video/');
  const canFindSimilar = asset.phash && asset.phash_status === 'done';
  const canFindSimilarClip = asset.clip_status === 'ready';
  const fileCount = Array.isArray(asset.files) ? asset.files.length : 0;

  const handleOpenLocation = async () => {
    try {
      if (window.electronAPI?.showInFolder) {
        const res = await openFileLocation(asset.hash);
        if (res?.path) {
          window.electronAPI.showInFolder(res.path);
        }
      } else {
        await openFileLocation(asset.hash);
      }
    } catch (err) {
      console.error('Failed to open file location:', err);
    }
  };

  const handleDateFilter = (type) => {
    if (!asset.taken_at) return;
    const d = new Date(asset.taken_at);
    if (type === 'from') {
      onApplyFilter?.({ from: d.setHours(0, 0, 0, 0) });
    } else {
      onApplyFilter?.({ to: d.setHours(23, 59, 59, 999) });
    }
  };

  return (
    <aside className="w-96 bg-white border-l shadow-xl z-20 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50 shrink-0">
        <h2 className="font-semibold text-gray-900">详情</h2>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
        >
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* Scrollable Content - unified scrolling */}
      <div className="flex-1 overflow-auto">
        {/* Preview - now scrolls with content */}
        <div className="p-4 border-b">
          <div
            className="aspect-square bg-gray-100 rounded-xl overflow-hidden relative group cursor-pointer"
            onClick={onOpenViewer}
          >
            {/* Background blur */}
            <img
              src={apiUrl(`/assets/${asset.hash}/preview?max=512&q=60`)}
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60"
              alt=""
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-black/5" />

            {/* Main image */}
            {!thumbError ? (
              <img
                src={apiUrl(`/assets/${asset.hash}/preview?max=1024&q=80`)}
                className="absolute inset-0 w-full h-full object-contain z-10"
                alt={asset.file_name || 'preview'}
                onError={() => setThumbError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center text-gray-400">
                  <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <span className="text-xs">无法加载预览</span>
                </div>
              </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors z-20 flex items-center justify-center opacity-0 group-hover:opacity-100">
              <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-2 shadow-lg">
                <Maximize2 className="h-4 w-4" />
                <span className="text-sm font-medium">查看大图</span>
              </div>
            </div>

            {/* Type badge */}
            <div className="absolute top-3 left-3 z-30">
              <Badge variant="secondary" className="bg-white/90 text-gray-700 text-[10px]">
                {asset.ext?.toUpperCase() || asset.mime_type?.split('/')[1]?.toUpperCase() || 'UNKNOWN'}
              </Badge>
            </div>

            {/* Video indicator */}
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                  <div className="w-0 h-0 border-t-6 border-t-transparent border-l-10 border-l-gray-800 border-b-6 border-b-transparent ml-1" />
                </div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 text-xs cursor-pointer"
              onClick={handleOpenLocation}
            >
              <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
              在文件夹中显示
            </Button>
            <Button
              variant="default"
              size="sm"
              className="flex-1 h-9 text-xs cursor-pointer"
              onClick={onOpenViewer}
            >
              <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
              全屏查看
            </Button>
          </div>
        </div>

        {/* Info */}
        <div className="p-4 border-b space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <Badge
              className={`
                ${asset.status === 'trash' ? 'bg-red-100 text-red-700 hover:bg-red-100' :
                  asset.status === 'sorted' ? 'bg-green-100 text-green-700 hover:bg-green-100' :
                    'bg-gray-100 text-gray-700 hover:bg-gray-100'}
              `}
            >
              {asset.status === 'trash' ? '已删除' :
                asset.status === 'sorted' ? '已整理' : '未整理'}
            </Badge>
            {asset.people_count > 0 && (
              <Badge variant="secondary" className="text-xs">
                <Users className="h-3 w-3 mr-1" />
                {asset.people_count} 人
              </Badge>
            )}
          </div>

          {/* Quick filter buttons */}
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                canFindSimilar
                  ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 hover:border-gray-300 cursor-pointer'
                  : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
              }`}
              disabled={!canFindSimilar}
              onClick={() => onApplySimilarPhash?.(asset)}
            >
              <Sparkles className="h-3 w-3" />
              相似图
            </button>
            <button
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                canFindSimilarClip
                  ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 hover:border-gray-300 cursor-pointer'
                  : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
              }`}
              disabled={!canFindSimilarClip}
              onClick={() => onApplySimilarClip?.(asset)}
            >
              <Sparkles className="h-3 w-3" />
              语义相似
            </button>
          </div>
        </div>

        {/* Info details */}
        <div className="p-4 space-y-1">
          <InfoRow icon={FileType} label="文件类型" value={asset.mime_type} />

          <InfoRow icon={HardDrive} label="文件大小" value={formatBytes(asset.size)} />

          <InfoRow icon={Calendar} label="时间">
            <div className="text-sm text-gray-900">
              {formatDate(asset.taken_at)}
            </div>
            {asset.taken_at && (
              <div className="flex gap-2 mt-2">
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                  onClick={() => handleDateFilter('from')}
                >
                  筛选从此日期
                </button>
                <button
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                  onClick={() => handleDateFilter('to')}
                >
                  筛选至此日期
                </button>
              </div>
            )}
          </InfoRow>

          <InfoRow
            icon={Camera}
            label="相机"
            value={[asset.camera_make, asset.camera_model].filter(Boolean).join(' ') || '—'}
          />

          <InfoRow icon={Hash} label="文件哈希">
            <div className="flex items-center gap-2">
              <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-600 break-all">
                {asset.hash}
              </code>
              <button
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 hover:border-gray-300 transition-colors cursor-pointer shrink-0"
                onClick={() => onApplyFilter?.({ hash: asset.hash })}
              >
                同Hash
              </button>
            </div>
          </InfoRow>
        </div>

        {/* Faces Panel */}
        <div className="px-4 pb-4">
          <AssetFacesPanel
            hash={asset.hash}
            assetUrl={apiUrl(`/assets/${asset.hash}/preview?max=4096&q=85`)}
            originalSize={{ width: asset.metadata?.width, height: asset.metadata?.height }}
            onFilterByPerson={onFilterByPerson}
          />
        </div>

        {/* Files List - No longer collapsible */}
        <div className="border-t">
          <div className="px-4 py-3 flex items-center gap-2">
            <FolderSearch className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-900">物理文件</span>
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              {fileCount}
            </Badge>
          </div>

          <div className="px-4 pb-4">
            <div className="space-y-2">
              {(asset.files || []).map((f) => (
                <div key={f.id || f.path} className="text-xs bg-gray-50 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-gray-700 break-all text-[11px]">
                      {f.path}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-[10px] text-gray-500">
                      {Number.isFinite(f.size) ? formatBytes(f.size) : '—'}
                      {f.mtime_ms && (
                        <span className="ml-2">{new Date(f.mtime_ms).toLocaleString()}</span>
                      )}
                    </div>
                    <button
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 hover:border-gray-300 transition-colors cursor-pointer"
                      onClick={() => onApplyFilter?.({ pathContains: dirPrefixOf(f.path) })}
                    >
                      同目录
                    </button>
                  </div>
                </div>
              ))}
              {fileCount === 0 && (
                <div className="text-xs text-gray-500 text-center py-4">无物理文件信息</div>
              )}
            </div>
          </div>
        </div>

        {/* Metadata - Collapsible */}
        <div className="border-t">
          <button
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
            onClick={() => setShowMetadata(!showMetadata)}
          >
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-900">元数据 (EXIF)</span>
            </div>
            <span className="text-gray-400 text-xs">
              {showMetadata ? '收起' : '展开'}
            </span>
          </button>

          {showMetadata && (
            <div className="px-4 pb-4">
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-[10px] whitespace-pre-wrap break-words overflow-auto max-h-60">
                {JSON.stringify(asset.metadata || {}, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Actions - sticky at bottom */}
        <div className="p-4 border-t bg-white">
          <Button
            variant="outline"
            size="sm"
            className={`w-full h-11 cursor-pointer ${
              asset.status === 'trash'
                ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                : 'text-red-600 hover:text-red-700 hover:bg-red-50'
            }`}
            onClick={() => onStatusChange?.('trash')}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            删除
          </Button>
        </div>
      </div>
    </aside>
  );
}
