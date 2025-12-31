/**
 * input: props + API 数据 + 本地状态
 * output: 功能/页面组件（React 组件）
 * pos: 客户端视图层：拼装业务交互（变更需同步更新本头注释与所属目录 README）
 */

import React from 'react';

/**
 * A consistent album-style placeholder block for items without thumbnails.
 *
 * - Top label: large (e.g. JPG / MP4 / FILE)
 * - Bottom text: smaller (e.g. filename / short hash)
 * - Optional date line
 */
export function ThumbPlaceholder({ topLabel, bottomText, dateText }) {
  const top = (topLabel || 'FILE').toString();
  const bottom = (bottomText || '').toString();

  return (
    <div className="w-full h-40 bg-gray-100 flex flex-col items-center justify-center text-center px-2">
      <div className="text-2xl font-extrabold tracking-wider text-gray-600">{top}</div>
      <div className="mt-1 text-[11px] text-gray-500 truncate w-full">{bottom}</div>
      {dateText ? <div className="mt-1 text-[10px] text-gray-400">{dateText}</div> : null}
    </div>
  );
}


