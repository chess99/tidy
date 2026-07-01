import { Video } from 'lucide-react';

export function VideoPosterFallback({
  topLabel = 'VIDEO',
  bottomText,
  className = '',
}) {
  return (
    <div className={`w-full h-full bg-gray-100 flex flex-col items-center justify-center text-center px-3 ${className}`}>
      <div className="h-10 w-10 rounded-full bg-white/85 border border-gray-200 shadow-sm flex items-center justify-center text-gray-600">
        <Video className="h-5 w-5" />
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-wider text-gray-600">{topLabel || 'VIDEO'}</div>
      {bottomText ? <div className="mt-1 max-w-full truncate text-[11px] text-gray-500">{bottomText}</div> : null}
    </div>
  );
}
