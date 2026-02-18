/**
 * input: props + API 数据 + 本地状态
 * output: 简化版设置界面（仅核心配置）
 * pos: 客户端视图层：精简的设置面板（变更需同步更新本头注释与所属目录 README）
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Loader2, Trash2, RefreshCw, Image, FileImage, Video, Settings2, FolderCheck } from 'lucide-react';
import { useState } from 'react';
import {
  addScanRoot,
  getConfig,
  removeScanRoot,
  setScanRootEnabled,
  setScanOptions,
  setScanType,
  setWorkspacePaths,
} from '../api/client';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Separator } from './ui/separator';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'rw2', 'orf', 'sr2', 'pef'];
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'];

function uniq(arr) {
  return Array.from(new Set(arr));
}

function Card({ title, icon: Icon, children, desc }) {
  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="h-5 w-5 text-gray-500" />}
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      {desc && <p className="text-sm text-gray-500 mb-4">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ScanRootsSection({ config }) {
  const queryClient = useQueryClient();
  const [newRoot, setNewRoot] = useState('');

  const addMutation = useMutation({
    mutationFn: addScanRoot,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const removeMutation = useMutation({
    mutationFn: removeScanRoot,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ root, enabled }) => setScanRootEnabled(root, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const roots = config?.scanRoots || [];

  return (
    <Card title="扫描目录" icon={FolderPlus} desc="添加需要管理的照片和视频文件夹，系统会自动监控文件变化">
      <div className="flex gap-2 mb-4">
        <Input
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="输入文件夹路径，例如 /Users/xxx/Pictures"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newRoot.trim()) {
              addMutation.mutate(newRoot.trim());
              setNewRoot('');
            }
          }}
        />
        <Button
          disabled={!newRoot.trim() || addMutation.isPending}
          onClick={() => {
            addMutation.mutate(newRoot.trim());
            setNewRoot('');
          }}
        >
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '添加'}
        </Button>
      </div>

      <div className="space-y-2">
        {roots.length === 0 && (
          <div className="text-sm text-gray-500 py-4 text-center bg-gray-50 rounded-lg">
            暂无扫描目录，请添加文件夹开始管理
          </div>
        )}
        {roots.map((r) => (
          <div
            key={r.root}
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border ${r.enabled !== false ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100'}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Checkbox
                checked={r.enabled !== false}
                onCheckedChange={(checked) => toggleMutation.mutate({ root: r.root, enabled: !!checked })}
              />
              <div className={`text-sm truncate ${r.enabled !== false ? 'text-gray-900' : 'text-gray-400'}`}>
                {r.root}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={() => removeMutation.mutate(r.root)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FileTypesSection({ config }) {
  const queryClient = useQueryClient();
  const scanType = config?.scanType || {};
  const currentExts = uniq((scanType.exts || []).map((e) => String(e).toLowerCase()));
  const includeNoExt = !!scanType.includeNoExt;

  const allImages = IMAGE_EXTS.every((e) => currentExts.includes(e));
  const allVideos = VIDEO_EXTS.every((e) => currentExts.includes(e));

  const mutation = useMutation({
    mutationFn: setScanType,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const toggleGroup = (exts, enable) => {
    const next = enable ? uniq([...currentExts, ...exts]) : currentExts.filter((x) => !exts.includes(x));
    mutation.mutate({ exts: next, includeNoExt });
  };

  return (
    <Card title="文件类型" icon={FileImage} desc="选择要管理的文件类型">
      <div className="space-y-3">
        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer">
          <Checkbox checked={allImages} onCheckedChange={(c) => toggleGroup(IMAGE_EXTS, !!c)} />
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">图片</div>
            <div className="text-xs text-gray-500">JPG, PNG, RAW 格式等</div>
          </div>
          <Image className="h-5 w-5 text-gray-400" />
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer">
          <Checkbox checked={allVideos} onCheckedChange={(c) => toggleGroup(VIDEO_EXTS, !!c)} />
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">视频</div>
            <div className="text-xs text-gray-500">MP4, MOV 等常见格式</div>
          </div>
          <Video className="h-5 w-5 text-gray-400" />
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer">
          <Checkbox
            checked={includeNoExt}
            onCheckedChange={(c) => mutation.mutate({ exts: currentExts, includeNoExt: !!c })}
          />
          <div className="text-sm font-medium text-gray-900">包含无扩展名文件</div>
        </label>
      </div>
    </Card>
  );
}

function WorkspaceSection({ config }) {
  const queryClient = useQueryClient();
  const [newManagedRoot, setNewManagedRoot] = useState('');
  const [showInput, setShowInput] = useState(false);

  const workspace = config?.workspace || {};
  const managedRoot = workspace?.MANAGED_ROOT || workspace?.managedRoot || '';

  const mutation = useMutation({
    mutationFn: setWorkspacePaths,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setNewManagedRoot('');
      setShowInput(false);
    },
  });

  return (
    <Card title="整理目标目录" icon={FolderCheck} desc="设置整理后的文件存放位置">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border bg-white">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-900 truncate" title={managedRoot}>
              {managedRoot || '未设置'}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowInput(!showInput);
              setNewManagedRoot('');
            }}
          >
            更改
          </Button>
        </div>

        {showInput && (
          <div className="flex gap-2">
            <Input
              value={newManagedRoot}
              onChange={(e) => setNewManagedRoot(e.target.value)}
              placeholder="例如: /Users/xxx/Pictures/Tidy"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newManagedRoot.trim()) {
                  mutation.mutate({ managedRoot: newManagedRoot.trim() });
                }
              }}
            />
            <Button
              disabled={!newManagedRoot.trim() || mutation.isPending}
              onClick={() => mutation.mutate({ managedRoot: newManagedRoot.trim() })}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function ExcludeRulesSection({ config }) {
  const queryClient = useQueryClient();
  const scan = config?.scan || {};
  const [newRule, setNewRule] = useState('');
  const excludeGlobs = scan.excludeGlobs || [];

  const mutation = useMutation({
    mutationFn: setScanOptions,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
  });

  const addRule = () => {
    const s = newRule.trim();
    if (!s) return;
    mutation.mutate({ excludeGlobs: uniq([...excludeGlobs, s]), minFileSizeBytes: scan.minFileSizeBytes || 0 });
    setNewRule('');
  };

  const removeRule = (g) => {
    mutation.mutate({
      excludeGlobs: excludeGlobs.filter((x) => x !== g),
      minFileSizeBytes: scan.minFileSizeBytes || 0,
    });
  };

  return (
    <Card title="排除规则" icon={Settings2} desc="设置不需要扫描的文件或文件夹">
      <div className="flex gap-2 mb-3">
        <Input
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          placeholder="例如: **/node_modules/**"
          onKeyDown={(e) => e.key === 'Enter' && addRule()}
        />
        <Button variant="outline" disabled={!newRule.trim() || mutation.isPending} onClick={addRule}>
          添加
        </Button>
      </div>

      <div className="space-y-2">
        {excludeGlobs.length === 0 && <div className="text-sm text-gray-500 py-2">未设置排除规则</div>}
        {excludeGlobs.map((g) => (
          <div key={g} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <code className="text-xs text-gray-700 break-all">{g}</code>
            <Button variant="ghost" size="sm" onClick={() => removeRule(g)}>
              移除
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SettingsViewSimple() {
  const { data: config, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <div className="flex items-center gap-2 mb-6">
        <RefreshCw className="h-6 w-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">设置</h1>
      </div>

      <ScanRootsSection config={config} />
      <WorkspaceSection config={config} />
      <FileTypesSection config={config} />
      <ExcludeRulesSection config={config} />

      <div className="text-xs text-gray-400 text-center pt-4">
        系统会自动处理文件扫描、缩略图生成、人脸识别等任务
      </div>
    </div>
  );
}
