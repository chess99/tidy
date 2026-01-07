/**
 * input: 仓库源码目录树（client/src、server/src、ai-service/app）
 * output: 文档一致性校验/自动补齐（README 与文件头注释）
 * pos: 工具脚本：保障分形自指文档约束（变更需同步更新本头注释与所属目录 README）
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const SOURCE_ROOTS = [
  'client/src',
  'server/src',
  'ai-service/app',
];

const CODE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py']);

const IGNORE_DIR_NAMES = new Set([
  '__pycache__',
  'node_modules',
  '.venv',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.vite',
]);

function posixJoin(...parts) {
  return parts.join('/').replace(/\/+/g, '/');
}

function isCodeFile(rel) {
  const ext = path.extname(rel);
  if (!CODE_EXTS.has(ext)) return false;
  const base = path.posix.basename(rel);
  if (base === 'README.md') return false;
  return true;
}

function headerLooksPresent(content, ext) {
  const head = content.split(/\r?\n/).slice(0, 20).join('\n');
  if (ext === '.py') {
    return head.includes('input:') && head.includes('output:') && head.includes('pos:');
  }
  return head.includes('input:') && head.includes('output:') && head.includes('pos:');
}

function describe(rel) {
  // rel is POSIX style, rooted at repo
  const p = rel;

  const mk = (input, output, pos) => ({
    input,
    output,
    pos: `${pos}（变更需同步更新本头注释与所属目录 README）`,
  });

  if (p.startsWith('client/src/api/')) {
    return mk('后端 HTTP API（baseURL/网络）', 'API 请求函数（统一参数/错误语义）', '客户端-服务端边界：API 调用封装');
  }
  if (p.startsWith('client/src/hooks/')) {
    return mk('组件参数 + 事件流 + Query/状态', '可复用 hook（state + handlers）', '客户端交互状态层：供组件复用');
  }
  if (p.startsWith('client/src/utils/')) {
    return mk('基础数据结构', '纯函数工具（布局/格式化等）', '客户端工具层：无 IO 的可测试逻辑');
  }
  if (p.startsWith('client/src/lib/')) {
    return mk('通用参数（className/配置）', '通用工具/小库封装', '客户端通用库层：跨组件复用');
  }
  if (p.startsWith('client/src/components/ui/')) {
    return mk('组件 props + 样式类名', '基础 UI 原语组件', '客户端 UI 原语层：被功能组件组合使用');
  }
  if (p.startsWith('client/src/components/')) {
    return mk('props + API 数据 + 本地状态', '功能/页面组件（React 组件）', '客户端视图层：拼装业务交互');
  }
  if (p === 'client/src/App.jsx') {
    return mk('React + Query + API client', '应用根组件（视图编排与全局交互）', '客户端根节点：承载主要视图与操作入口');
  }
  if (p === 'client/src/main.jsx') {
    return mk('浏览器 DOM + React 运行时', '挂载应用到页面根节点', '客户端入口：渲染 App 并加载全局样式');
  }

  if (p.startsWith('server/src/routes/')) {
    return mk('Express req/res + DB + 服务层', 'Express Router（HTTP API）', '服务端路由层：把请求映射为领域动作');
  }
  if (p.startsWith('server/src/db/')) {
    return mk('SQLite 文件/连接参数', 'DB 访问入口与 schema', '服务端数据层：统一 DB 初始化与访问');
  }
  if (p.startsWith('server/src/scanner/')) {
    return mk('文件路径/媒体字节 + 配置', 'hash/元信息/缩略图/人脸等派生产物', '服务端扫描管线：从文件系统提取结构化信息');
  }
  if (p.startsWith('server/src/jobs/handlers/')) {
    return mk('job payload + DB/文件系统/服务层', '任务执行副作用 + 进度/结果写回', '服务端任务处理器：实现具体 job 类型');
  }
  if (p.startsWith('server/src/jobs/')) {
    return mk('任务请求 + 配置/DB', '任务调度/存储/生命周期管理', '服务端任务系统：编排后台作业');
  }
  if (p.startsWith('server/src/services/')) {
    return mk('DB + 文件系统 + 配置', '领域服务函数（可复用业务动作）', '服务端服务层：跨路由/任务复用的领域能力');
  }
  if (p.startsWith('server/src/sync/')) {
    return mk('DB 变更记录/文件系统状态', '增量变更/同步结果', '服务端同步层：对账与增量更新');
  }
  if (p.startsWith('server/src/utils/')) {
    return mk('基础值/路径字符串', '通用工具函数', '服务端工具层：无业务语义的复用工具');
  }
  if (p.startsWith('server/src/')) {
    return mk('环境变量/配置 + DB', '服务端模块导出', '服务端核心模块：被 server 入口与路由/任务依赖');
  }

  if (p === 'ai-service/app/main.py') {
    return mk('base64 图片/本地路径 + InsightFace/OpenCV + CLIP', '人脸检测框/关键点/embedding 向量；CLIP 图像/文本 embedding', 'Python AI 服务入口：供主服务调用');
  }

  return mk('外部依赖', '对外导出', '模块');
}

function renderHeader(rel, ext) {
  const d = describe(rel);
  if (ext === '.py') {
    return `"""input: ${d.input}\noutput: ${d.output}\npos: ${d.pos}\n"""\n\n`;
  }
  return `/**\n * input: ${d.input}\n * output: ${d.output}\n * pos: ${d.pos}\n */\n\n`;
}

async function walkDir(absDir, relDir, out) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = posixJoin(relDir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(e.name)) continue;
      await walkDir(abs, rel, out);
    } else {
      out.push({ abs, rel });
    }
  }
}

async function listAllFiles() {
  const out = [];
  for (const root of SOURCE_ROOTS) {
    const absRoot = path.join(ROOT, root);
    await walkDir(absRoot, root, out);
  }
  return out;
}

async function cmdAddHeaders() {
  const files = await listAllFiles();
  let changed = 0;
  for (const f of files) {
    if (!isCodeFile(f.rel)) continue;
    const ext = path.extname(f.rel);
    const content = await fs.readFile(f.abs, 'utf8');
    if (headerLooksPresent(content, ext)) continue;
    const header = renderHeader(f.rel, ext);
    await fs.writeFile(f.abs, header + content, 'utf8');
    changed += 1;
  }
  process.stdout.write(`added headers: ${changed}\n`);
}

async function cmdCheck() {
  const files = await listAllFiles();
  const missingHeaders = [];
  const missingReadmes = [];

  // Check directory README.md existence
  for (const root of SOURCE_ROOTS) {
    const absRoot = path.join(ROOT, root);
    const dirs = [absRoot];
    while (dirs.length) {
      const dAbs = dirs.pop();
      const entries = await fs.readdir(dAbs, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          if (IGNORE_DIR_NAMES.has(e.name)) continue;
          dirs.push(path.join(dAbs, e.name));
        }
      }
      const readme = path.join(dAbs, 'README.md');
      try {
        await fs.access(readme);
      } catch {
        const rel = path.posix.relative(ROOT, dAbs).replace(/\\/g, '/');
        missingReadmes.push(rel);
      }
    }
  }

  // Check file headers
  for (const f of files) {
    if (!isCodeFile(f.rel)) continue;
    const ext = path.extname(f.rel);
    const content = await fs.readFile(f.abs, 'utf8');
    if (!headerLooksPresent(content, ext)) missingHeaders.push(f.rel);
  }

  const hasErrors = missingReadmes.length || missingHeaders.length;
  if (!hasErrors) {
    process.stdout.write('fractal-docs: OK\n');
    return;
  }

  if (missingReadmes.length) {
    process.stdout.write('\nmissing README.md in directories:\n');
    for (const d of missingReadmes.sort()) process.stdout.write(`- ${d}\n`);
  }
  if (missingHeaders.length) {
    process.stdout.write('\nmissing file headers (input/output/pos):\n');
    for (const f of missingHeaders.sort()) process.stdout.write(`- ${f}\n`);
  }
  process.exitCode = 1;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'add-headers') return cmdAddHeaders();
  if (cmd === 'check') return cmdCheck();

  process.stdout.write(
    'usage:\n' +
      '  node scripts/fractal-docs.mjs add-headers\n' +
      '  node scripts/fractal-docs.mjs check\n'
  );
  process.exitCode = 2;
}

await main();


