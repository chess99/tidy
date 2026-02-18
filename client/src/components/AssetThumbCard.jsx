/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import clsx from 'clsx';
import { apiUrl } from '../api/client';
import { fileNameFromPath } from '../utils/mediaLabel';
import { ThumbPlaceholder } from './ThumbPlaceholder';

/**
 * Shared thumbnail card used by both `FilesGrid` and album asset grids.
 *
 * Keep it flexible: callers decide what to show for bottom texts + overlays.
 */
export function AssetThumbCard({
  hash,
  thumbVersion = 0,
  imageUrl,
  topLabel = 'FILE',
  placeholderBottomText,
  dateText,
  dimmed = false,
  selected = false,
  cursorFocused = false,
  onToggleSelected,
  badges = [],
  bottomPrimary,
  bottomSecondary,
  bottomSecondaryTitle,
  bottomContent,
  onClick,
  isPlaceholder = false,
}) {
  const hasHash = !!hash;
  const safeBottomPrimary =
    bottomPrimary != null ? bottomPrimary : (isPlaceholder ? '—' : fileNameFromPath(placeholderBottomText || '') || '—');
  const safeBottomSecondary = bottomSecondary != null ? bottomSecondary : (isPlaceholder ? null : placeholderBottomText);
  const placeholderName = placeholderBottomText || safeBottomPrimary || '—';

  const showCursorRing = !!cursorFocused && !isPlaceholder;
  const showSelectedRing = !!selected && !isPlaceholder;

  return (
    <div
      className={clsx(
        'flex-1 relative bg-white shadow-sm rounded overflow-hidden cursor-pointer transition-shadow',
        isPlaceholder ? 'cursor-default opacity-80' : 'hover:shadow-md',
        dimmed ? 'opacity-50 grayscale' : null,
        showCursorRing ? 'ring-2 ring-blue-600' : null,
        !showCursorRing && showSelectedRing ? 'ring-2 ring-emerald-500' : null,
        showCursorRing && showSelectedRing ? 'outline outline-2 outline-emerald-400 outline-offset-[-2px]' : null
      )}
      onClick={() => (isPlaceholder ? null : onClick?.())}
    >
      <div className="relative w-full h-40 bg-gray-100">
        <div className="absolute inset-0">
          <ThumbPlaceholder topLabel={topLabel} bottomText={placeholderName} dateText={dateText} />
        </div>

        {hasHash ? (
          <img
            src={imageUrl || apiUrl(`/assets/${hash}/thumb?v=${thumbVersion || 0}`)}
            alt={hash}
            className="relative z-10 w-full h-40 object-cover"
            loading="lazy"
            onError={(e) => {
              // Hide broken thumb and fall back to placeholder.
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : null}

        {/* Always-visible type/ext badge (so cards remain distinguishable even with thumbs). */}
        {!isPlaceholder && topLabel ? (
          <div
            className={clsx(
              'absolute bottom-2 left-2 z-20 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide shadow-sm',
              'bg-white/90 text-gray-800 border border-gray-200'
            )}
            title={topLabel}
          >
            {topLabel}
          </div>
        ) : null}

        {!isPlaceholder && typeof onToggleSelected === 'function' ? (
          <button
            type="button"
            className={clsx(
              'absolute top-2 left-2 z-20 w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold shadow-sm',
              selected ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white/90 text-gray-700 border-gray-200'
            )}
            title={selected ? '取消选择' : '选择'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelected();
            }}
          >
            {selected ? '✓' : ''}
          </button>
        ) : null}

        {!isPlaceholder && Array.isArray(badges)
          ? badges
              .filter(Boolean)
              .slice(0, 3)
              .map((b, i) => (
                <div key={b.key || i} className={clsx('absolute z-20 text-[10px] px-2 py-0.5 rounded shadow-sm', b.className)} style={b.style}>
                  {b.text}
                </div>
              ))
          : null}
      </div>

      <div className="h-16 p-2 text-xs flex flex-col justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-gray-900 truncate" title={safeBottomPrimary || ''}>
              {safeBottomPrimary || '—'}
            </div>
          </div>
          <div className="shrink-0 tabular-nums text-[11px] text-gray-700">{dateText || '—'}</div>
        </div>

        {!isPlaceholder && bottomContent != null ? (
          bottomContent
        ) : !isPlaceholder && safeBottomSecondary ? (
          <div
            className="text-[11px] text-gray-600 leading-4"
            title={bottomSecondaryTitle || safeBottomSecondary}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {safeBottomSecondary}
          </div>
        ) : null}
      </div>
    </div>
  );
}


