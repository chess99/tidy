/**
 * input: TanStack Query + API（jobs/config）+ 子组件
 * output: 简化版系统管理视图（设置 + 任务状态）
 * pos: 客户端系统管理页面：精简的设置与任务状态展示（变更需同步更新本头注释与所属目录 README）
 */

import { SettingsViewSimple } from './SettingsViewSimple';
import { TasksStatus } from './TasksStatus';

export function SystemAdminView() {
  return (
    <div className="h-full w-full bg-gray-50 overflow-y-auto">
      <div className="max-w-6xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">系统管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理系统设置和查看任务状态</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Settings */}
          <div className="lg:col-span-2">
            <SettingsViewSimple />
          </div>

          {/* Right: Task Status */}
          <div className="lg:col-span-1">
            <div className="bg-white border rounded-xl p-5 shadow-sm sticky top-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">任务状态</h3>
              <TasksStatus />

              <div className="mt-4 pt-4 border-t text-xs text-gray-400">
                系统会自动检测文件变化并执行必要的处理任务
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
