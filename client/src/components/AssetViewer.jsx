/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiUrl } from '../api/client';
import clsx from 'clsx';

function isVideoMime(mime) {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('video/');
}

export function AssetViewer({ open, onOpenChange, asset, defaultMax = 4096, defaultQuality = 85, onPrev, onNext }) {
  const hash = asset?.hash || null;
  const mime = asset?.mime_type || null;
  const isMissing = !!asset?.missing;
  const isVideo = isVideoMime(mime);
  const canPrev = typeof onPrev === 'function';
  const canNext = typeof onNext === 'function';

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const draggingRef = useRef(null); // {x,y,tx,ty}

  const reset = () => {
    setScale(1);
    setTx(0);
    setTy(0);
  };

  // Reset transform when opening or switching assets.
  useEffect(() => {
    if (!open) return;
    reset();
     
  }, [open, hash]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange?.(false);
      if (!hash) return;
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
      if (!isVideo) {
        if (e.key === '+' || e.key === '=') setScale((s) => Math.min(8, s * 1.2));
        if (e.key === '-') setScale((s) => Math.max(0.2, s / 1.2));
        if (e.key === '0') reset();
      }
    };
    // Use capture to avoid other components intercepting Escape (common in Dialog libraries).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, hash, isVideo, onOpenChange, onPrev, onNext]);

  const previewUrl = useMemo(() => {
    if (!hash) return null;
    return apiUrl(`/assets/${hash}/preview?max=${defaultMax}&q=${defaultQuality}`);
  }, [hash, defaultMax, defaultQuality]);

  const rawUrl = useMemo(() => (hash && !isMissing ? apiUrl(`/assets/${hash}/raw`) : null), [hash, isMissing]);
  const videoUrl = useMemo(() => (hash ? apiUrl(`/assets/${hash}/video`) : null), [hash]);
  const posterUrl = useMemo(() => (hash ? apiUrl(`/assets/${hash}/poster?w=1280&q=4`) : null), [hash]);
  const [posterError, setPosterError] = useState(false);

  const [imgUrl, setImgUrl] = useState(null);
  useEffect(() => {
    setImgUrl(previewUrl);
  }, [previewUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="absolute inset-0 cursor-pointer" onMouseDown={() => onOpenChange?.(false)} />

      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {/* Top bar */}
        <div className="pointer-events-auto flex items-center justify-between px-4 py-3 text-white">
          <div className="min-w-0 flex items-center gap-3">
            <div className="text-sm font-semibold truncate">{hash || '—'}</div>
            {mime ? <div className="text-xs text-white/70 truncate">{mime}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            {!isVideo ? (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                  onClick={() => setScale((s) => Math.min(8, s * 1.2))}
                  title="放大 (+)"
                >
                  <ZoomIn className="h-4 w-4" />
                  <span className="text-xs">放大</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                  onClick={() => setScale((s) => Math.max(0.2, s / 1.2))}
                  title="缩小 (-)"
                >
                  <ZoomOut className="h-4 w-4" />
                  <span className="text-xs">缩小</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                  onClick={reset}
                  title="重置 (0)"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span className="text-xs">重置</span>
                </button>
              </>
            ) : null}

            {rawUrl ? (
              <a
                className="inline-flex items-center gap-2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                href={rawUrl}
                target="_blank"
                rel="noreferrer"
                title="打开原文件"
              >
                <ExternalLink className="h-4 w-4" />
                <span className="text-xs">打开原文件</span>
              </a>
            ) : null}

            <button
              type="button"
              className="inline-flex items-center justify-center w-9 h-9 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
              onClick={() => onOpenChange?.(false)}
              title="关闭 (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 pointer-events-auto flex items-center justify-center px-4 pb-6">
          <div
            className={clsx(
              'relative w-full h-full max-w-[92vw] max-h-[82vh] rounded-lg overflow-hidden bg-black/30',
              isVideo ? 'flex items-center justify-center' : null
            )}
            onMouseDown={(e) => {
              if (isVideo) return;
              // Only left button.
              if (e.button !== 0) return;
              draggingRef.current = { x: e.clientX, y: e.clientY, tx, ty };
            }}
            onMouseMove={(e) => {
              if (isVideo) return;
              const d = draggingRef.current;
              if (!d) return;
              const dx = e.clientX - d.x;
              const dy = e.clientY - d.y;
              setTx(d.tx + dx);
              setTy(d.ty + dy);
            }}
            onMouseUp={() => {
              draggingRef.current = null;
            }}
            onMouseLeave={() => {
              draggingRef.current = null;
            }}
            onWheel={(e) => {
              if (isVideo) return;
              e.preventDefault();
              const delta = e.deltaY;
              const factor = delta > 0 ? 1 / 1.15 : 1.15;
              setScale((s) => Math.max(0.2, Math.min(8, s * factor)));
            }}
          >
            {/* Prev / Next controls */}
            <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
              {canPrev ? (
                <button
                  type="button"
                  className={clsx(
                    'pointer-events-auto ml-3 inline-flex items-center justify-center w-11 h-11 rounded-full',
                    'bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 shadow-lg',
                    'text-white focus:outline-none focus:ring-2 focus:ring-white/40'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPrev?.();
                  }}
                  title="上一张 (←)"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
              ) : null}
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center justify-end pointer-events-none">
              {canNext ? (
                <button
                  type="button"
                  className={clsx(
                    'pointer-events-auto mr-3 inline-flex items-center justify-center w-11 h-11 rounded-full',
                    'bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 shadow-lg',
                    'text-white focus:outline-none focus:ring-2 focus:ring-white/40'
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNext?.();
                  }}
                  title="下一张 (→)"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              ) : null}
            </div>

            {isVideo ? (
              videoUrl ? (
                <>
                  {posterError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-sm text-white/70 bg-black/30">
                      <div className="text-center px-4">
                        <div className="mb-2">无法生成视频缩略图</div>
                        <div className="text-xs text-white/60">
                          需要安装 ffmpeg
                        </div>
                        <div className="text-xs text-white/50 mt-1 font-mono">
                          macOS: brew install ffmpeg
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <video
                    controls
                    className="w-full h-full"
                    src={videoUrl}
                    poster={posterError ? undefined : (posterUrl || undefined)}
                    onLoadedMetadata={() => setPosterError(false)}
                  />
                  {posterUrl && !posterError ? (
                    <img
                      src={posterUrl}
                      alt="poster"
                      className="hidden"
                      onError={() => setPosterError(true)}
                    />
                  ) : null}
                </>
              ) : (
                <div className="text-sm text-white/70">无视频资源</div>
              )
            ) : imgUrl ? (
              <img
                src={imgUrl}
                alt={hash || 'preview'}
                className="absolute inset-0 w-full h-full select-none"
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  transformOrigin: 'center center',
                  cursor: scale > 1 ? 'grab' : 'default',
                  objectFit: 'contain',
                }}
                draggable={false}
                onError={() => {
                  // Fallback to raw if preview fails.
                  if (rawUrl && imgUrl !== rawUrl) setImgUrl(rawUrl);
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">无预览</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


