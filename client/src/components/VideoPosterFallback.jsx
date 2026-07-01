import { Video } from 'lucide-react';

function getPlatformInstallCommand() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const platform = String(nav?.platform || nav?.userAgent || '').toLowerCase();
  if (platform.includes('mac')) {
    return { label: 'macOS', command: 'brew install ffmpeg' };
  }
  if (platform.includes('linux')) {
    return { label: 'Linux', command: 'sudo apt install ffmpeg' };
  }
  return { label: 'Windows', command: 'winget install --id Gyan.FFmpeg' };
}

export function VideoPosterFallback({
  topLabel = 'VIDEO',
  bottomText,
  showInstallHint = false,
  className = '',
}) {
  const hint = getPlatformInstallCommand();

  return (
    <div className={`w-full h-full bg-gray-100 flex flex-col items-center justify-center text-center px-3 ${className}`}>
      <div className="h-10 w-10 rounded-full bg-white/85 border border-gray-200 shadow-sm flex items-center justify-center text-gray-600">
        <Video className="h-5 w-5" />
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-wider text-gray-600">{topLabel || 'VIDEO'}</div>
      {bottomText ? <div className="mt-1 max-w-full truncate text-[11px] text-gray-500">{bottomText}</div> : null}
      {showInstallHint ? (
        <div className="mt-2 max-w-full rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-4 text-amber-800">
          <div>需要 ffmpeg 生成视频缩略图</div>
          <div className="truncate font-mono" title={`${hint.label}: ${hint.command}`}>
            {hint.label}: {hint.command}
          </div>
        </div>
      ) : null}
    </div>
  );
}
