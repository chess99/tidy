import clsx from 'clsx';
import { useState } from 'react';
import { apiUrl } from '../api/client';
import { fileNameFromPath } from '../utils/mediaLabel';
import { ThumbPlaceholder } from './ThumbPlaceholder';
import { VideoPosterFallback } from './VideoPosterFallback';

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
  mediaKind = 'file',
  thumbnailHeight,
}) {
  const hasHash = !!hash;
  const isVideo = mediaKind === 'video';
  const safeBottomPrimary =
    bottomPrimary != null ? bottomPrimary : (isPlaceholder ? '—' : fileNameFromPath(placeholderBottomText || '') || '—');
  const safeBottomSecondary = bottomSecondary != null ? bottomSecondary : (isPlaceholder ? null : placeholderBottomText);
  const placeholderName = placeholderBottomText || safeBottomPrimary || '—';

  const showCursorRing = !!cursorFocused && !isPlaceholder;
  const showSelectedRing = !!selected && !isPlaceholder;
  const resolvedImageUrl = hasHash
    ? (imageUrl || apiUrl(
        isVideo
          ? `/assets/${hash}/poster?w=640&q=4`
          : `/assets/${hash}/thumb?v=${thumbVersion || 0}`
      ))
    : null;
  const imageKey = resolvedImageUrl || '';
  const [failedImageKey, setFailedImageKey] = useState(null);
  const imageFailed = !!imageKey && failedImageKey === imageKey;
  const thumbnailStyle = Number.isFinite(Number(thumbnailHeight))
    ? { height: `${Math.max(1, Number(thumbnailHeight))}px` }
    : { aspectRatio: '4 / 3' };

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
      <div className="relative w-full overflow-hidden bg-gray-200" style={thumbnailStyle}>
        <div className="absolute inset-0">
          {isVideo ? (
            <VideoPosterFallback topLabel={topLabel || 'VIDEO'} bottomText={placeholderName} />
          ) : (
            <ThumbPlaceholder topLabel={topLabel} bottomText={placeholderName} dateText={dateText} />
          )}
        </div>

        {hasHash && !imageFailed ? (
          <img
            src={resolvedImageUrl}
            alt={placeholderName || hash}
            className="relative z-10 h-full w-full object-contain"
            loading="lazy"
            onError={() => {
              setFailedImageKey(imageKey);
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

      <div className="h-20 p-2 text-xs flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] leading-4 text-gray-900 break-all"
              title={safeBottomPrimary || ''}
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
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
              overflowWrap: 'anywhere',
            }}
          >
            {safeBottomSecondary}
          </div>
        ) : null}
      </div>
    </div>
  );
}
