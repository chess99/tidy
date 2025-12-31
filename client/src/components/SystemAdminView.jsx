/**
 * input: TanStack Query + API（jobs/config）+ 子组件（SettingsView/TasksView）
 * output: 系统管理视图（配置 + 任务队列的统一入口）
 * pos: 客户端系统管理页面：承载 immich 风格任务与配置（变更需同步更新本头注释与所属目录 README）
 */

import { useState } from 'react';
import { SettingsView } from './SettingsView';
import { TasksView } from './TasksView';

export function SystemAdminView() {
  const [settingsAnchor, setSettingsAnchor] = useState(null);

  return (
    <div className="h-full w-full bg-gray-50">
      <div className="h-full w-full flex overflow-hidden">
        {/* Left: config */}
        <div className="w-[520px] max-w-[50%] border-r bg-gray-50 overflow-y-auto">
          <SettingsView anchor={settingsAnchor} embedded />
        </div>

        {/* Right: tasks */}
        <div className="flex-1 overflow-y-auto">
          <TasksView
            embedded
            onJumpSettings={(anchor) => {
              setSettingsAnchor(anchor || null);
            }}
          />
        </div>
      </div>
    </div>
  );
}


