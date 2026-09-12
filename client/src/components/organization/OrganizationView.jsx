import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  History,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  MapPin,
  RotateCcw,
  Search,
  Settings2,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { apiUrl } from "../../api/client";
import {
  loadOrganization,
  generateOrganization,
  acceptOrganization,
  editOrganization,
  previewOrganization,
  getOrganizationRun,
  getOrganizationMoves,
  applyOrganization,
  cancelOrganization,
  importOrganization,
  rollbackOrganization,
  pauseOrganization,
} from "../../api/organization";
import { SnapshotBrowser } from "./SnapshotBrowser";
import { PlanFileDialog } from "./PlanFileDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { makeTree, findNode, flattenItems, treeRows } from "./tree";
import "./organization.css";

const fmt = (value) => Number(value || 0).toLocaleString("zh-CN");
const date = (value) =>
  value ? new Date(value).toISOString().slice(0, 10) : "日期未定";
const time = (value) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
function Photo({ item, large = false }) {
  const [failed, setFailed] = useState(false);
  return failed || !item?.hash ? (
    <span className="org-placeholder">
      <ImageIcon size={24} />
    </span>
  ) : (
    <img
      loading="lazy"
      alt={item.name}
      src={apiUrl(`/assets/${item.hash}/${large ? "preview" : "thumb"}`)}
      onError={() => setFailed(true)}
    />
  );
}
function PhotoGrid({ items, selected, onSelect, onOpen, assignments }) {
  "use no memo";
  const scroll = useRef(null);
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const element = scroll.current;
    const observer = new ResizeObserver(([entry]) =>
      setColumns(Math.max(2, Math.floor(entry.contentRect.width / 190))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // TanStack Virtual is intentionally outside React Compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rows = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => 206,
    overscan: 3,
  });
  return (
    <div ref={scroll} className="org-photo-scroll">
      <div style={{ height: rows.getTotalSize(), position: "relative" }}>
        {rows.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="org-photo-row"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {items
              .slice(row.index * columns, (row.index + 1) * columns)
              .map((item) => (
                <div
                  key={item.id}
                  className={`org-photo ${selected.has(item.id) ? "is-selected" : ""}`}
                >
                  <button
                    className="org-photo-image"
                    onClick={() => onOpen(item)}
                  >
                    <Photo item={item} />
                  </button>
                  <input
                    aria-label={`选择 ${item.name}`}
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => onSelect(item.id)}
                  />
                  {assignments[item.id]?.manual && (
                    <span className="org-lock" title="已固定归属">
                      <LockKeyhole size={12} />
                    </span>
                  )}
                  <div className="org-photo-caption">
                    <span title={item.name}>{item.name}</span>
                    <small>
                      {date(item.time)}
                      {item.files.length > 1
                        ? ` · ${item.files.length} 个文件`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
function RulesDialog({ initial, onClose, onGenerate, working }) {
  const [rules, setRules] = useState(initial);
  const [themes, setThemes] = useState(
    (initial.themes || []).map((t) => `${t.name}=${t.query}`).join("\n"),
  );
  const change = (key, value) => setRules((r) => ({ ...r, [key]: value }));
  return (
    <Dialog open onOpenChange={(open) => !open && !working && onClose()}>
      <DialogContent className="org-dialog">
        <DialogTitle>整理规则</DialogTitle>
        <DialogDescription>调整分组尺度和目录结构</DialogDescription>
        <div className="org-rule-fields">
          <label>
            连续拍摄间隔
            <select
              value={rules.gapHours}
              onChange={(e) => change("gapHours", Number(e.target.value))}
            >
              <option value="4">4 小时 · 较细</option>
              <option value="8">8 小时 · 标准</option>
              <option value="18">18 小时 · 较宽</option>
              <option value="36">36 小时 · 较宽</option>
            </select>
          </label>
          <label>
            多日行程最长跨度
            <select
              value={rules.tripDays}
              onChange={(e) => change("tripDays", Number(e.target.value))}
            >
              {[1, 3, 7, 14, 21].map((n) => (
                <option key={n} value={n}>
                  {n} 天
                </option>
              ))}
            </select>
          </label>
          <label>
            独立事件最少照片
            <select
              value={rules.minPhotos}
              onChange={(e) => change("minPhotos", Number(e.target.value))}
            >
              {[2, 5, 8, 15, 30].map((n) => (
                <option key={n} value={n}>
                  {n} 项
                </option>
              ))}
            </select>
          </label>
          <label>
            日常和散片
            <select
              value={rules.dailyPeriod}
              onChange={(e) => change("dailyPeriod", e.target.value)}
            >
              <option value="year">按年归拢</option>
              <option value="month">按月归拢</option>
            </select>
          </label>
          <label>
            夜间停拍容忍
            <select
              value={rules.overnightHours ?? 18}
              onChange={(e) => change("overnightHours", Number(e.target.value))}
            >
              {[12, 18, 24].map((n) => (
                <option key={n} value={n}>
                  {n} 小时
                </option>
              ))}
            </select>
          </label>
          <label>
            行程中的最长停拍
            <select
              value={rules.tripGapHours ?? 72}
              onChange={(e) => change("tripGapHours", Number(e.target.value))}
            >
              {[24, 48, 72, 120].map((n) => (
                <option key={n} value={n}>
                  {n / 24} 天
                </option>
              ))}
            </select>
          </label>
          <label className="org-check">
            <input
              type="checkbox"
              checked={rules.preserveNamed}
              onChange={(e) => change("preserveNamed", e.target.checked)}
            />
            保留已有命名目录
          </label>
          <label className="org-full">
            独立主题
            <textarea
              rows={3}
              value={themes}
              onChange={(e) => setThemes(e.target.value)}
              placeholder={"猫=家中宠物猫\n航拍=从空中俯瞰的城市和山川"}
            />
            <small>每行一个主题，等号后为识别描述。最多 8 个。</small>
          </label>
        </div>
        {rules.places?.length > 0 && (
          <div className="org-place-list">
            {rules.places.map((p, i) => (
              <span key={i}>
                {p.name}
                <button
                  aria-label={`移除地点 ${p.name}`}
                  onClick={() =>
                    change(
                      "places",
                      rules.places.filter((_, n) => n !== i),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="org-dialog-actions">
          <span>手动指定的归属会保留</span>
          <Button
            disabled={working}
            onClick={() =>
              onGenerate({
                ...rules,
                themes: themes
                  .split("\n")
                  .filter((l) => l.trim())
                  .map((line) => {
                    const [name, ...query] = line.split("=");
                    return {
                      name: name.trim(),
                      query: query.join("=").trim() || name.trim(),
                    };
                  }),
              })
            }
          >
            {working && <Loader2 className="animate-spin" size={15} />}重新生成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function RunDialog({ root, runId, onClose, onFinished }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(0);
  const movesQuery = useQuery({
    queryKey: ["organization-moves", root, runId, page],
    queryFn: () => getOrganizationMoves(root, runId, page * 200),
    enabled: page > 0,
  });
  const query = useQuery({
    queryKey: ["organization-run", root, runId],
    queryFn: () => getOrganizationRun(root, runId),
    refetchInterval: (q) =>
      ["preparing", "applying"].includes(q.state.data?.status) &&
      !q.state.data?.interrupted
        ? 1000
        : false,
  });
  const run = query.data;
  const running =
    run && ["preparing", "applying"].includes(run.status) && !run.interrupted;
  const act = async (action) => {
    setSubmitting(true);
    setError("");
    try {
      await action();
      await qc.invalidateQueries({
        queryKey: ["organization-run", root, runId],
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };
  const label =
    run?.status === "cancelled"
      ? "检查已取消"
      : run?.status === "rolled_back"
        ? "已恢复原目录"
        : run?.status === "done"
          ? "整理已完成"
          : run?.status === "failed" ||
              run?.status === "paused" ||
              run?.interrupted
            ? "整理需要处理"
            : "目录变更";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="org-dialog org-run-dialog">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>
          {running
            ? `${run.phase} · ${fmt(run.done || run.checked)} 项`
            : `${fmt(run?.totalMoves)} 个文件移动或改名`}
        </DialogDescription>
        {(error || query.error || run?.error) && (
          <div className="org-error" role="alert">
            {error || query.error?.message || run.error}
          </div>
        )}
        {running && (
          <div className="org-progress">
            <Loader2 size={18} className="animate-spin" />
            {run.phase}
          </div>
        )}
        {running && run.currentFile && (
          <small className="org-current-file" title={run.currentFile}>
            {run.currentFile}
            {run.total ? ` · ${fmt(run.checked)} / ${fmt(run.total)}` : ""}
          </small>
        )}
        {run?.skipped?.length > 0 && (
          <div className="org-warning">
            {fmt(run.skipped.length)} 个历史文件缺失或内容变化，将跳过。
            {run.added > 0 && ` ${fmt(run.added)} 个当前文件保持原位。`}
            <details>
              <summary>查看未恢复项</summary>
              {run.skipped.map((s) => (
                <p key={s.path}>
                  {s.path} · {s.reason}
                </p>
              ))}
            </details>
          </div>
        )}
        <div className="org-diff">
          {run?.directoryChanges?.map((d) => (
            <div key={d}>
              <strong>恢复目录：{d}</strong>
            </div>
          ))}
          {(page ? movesQuery.data || [] : run?.moves || []).map((m) => (
            <div key={m.from}>
              <span title={m.from}>{m.from}</span>
              <ArrowRight size={13} />
              <strong title={m.to}>{m.to}</strong>
            </div>
          ))}
          {movesQuery.isFetching && <p>读取变更…</p>}
          {movesQuery.error && <p role="alert">{movesQuery.error.message}</p>}
        </div>
        {run?.totalMoves > 200 && (
          <div className="org-pages">
            <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              {page + 1} / {Math.ceil(run.totalMoves / 200)}
            </span>
            <button
              disabled={(page + 1) * 200 >= run.totalMoves}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
        <div className="org-dialog-actions">
          <span>恢复目录不会还原被删除或覆盖的文件内容</span>
          {running && run.status === "preparing" && (
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => act(() => cancelOrganization(root, runId))}
            >
              取消检查
            </Button>
          )}
          {running && run.status === "applying" && (
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => act(() => pauseOrganization(root, runId))}
            >
              暂停执行
            </Button>
          )}
          {run?.status === "ready" && (
            <Button
              disabled={
                submitting || (!run.totalMoves && !run.directoryChanges?.length)
              }
              onClick={() => act(() => applyOrganization(root, runId))}
            >
              应用到磁盘
            </Button>
          )}
          {(run?.status === "failed" ||
            run?.status === "paused" ||
            run?.interrupted) && (
            <>
              {run.started && run.direction !== "rollback" && (
                <Button
                  variant="outline"
                  disabled={submitting}
                  onClick={() => act(() => rollbackOrganization(root, runId))}
                >
                  恢复应用前目录
                </Button>
              )}
              {!run.started && (
                <Button
                  variant="outline"
                  disabled={submitting}
                  onClick={() =>
                    act(async () => {
                      await cancelOrganization(root, runId);
                      onFinished();
                    })
                  }
                >
                  放弃检查
                </Button>
              )}
              {(run.started || run.status === "paused") && (
                <Button
                  disabled={submitting}
                  onClick={() => act(() => applyOrganization(root, runId))}
                >
                  继续执行
                </Button>
              )}
            </>
          )}
          {["done", "rolled_back", "cancelled"].includes(run?.status) && (
            <Button onClick={onFinished}>
              <Check size={16} />
              完成
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OrganizationView() {
  const qc = useQueryClient();
  const [root, setRoot] = useState("");
  const [folder, setFolder] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [target, setTarget] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runId, setRunId] = useState(null);
  const [opened, setOpened] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState([]);
  const [redo, setRedo] = useState([]);
  const [placeName, setPlaceName] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [planFilesOpen, setPlanFilesOpen] = useState(false);
  const [version, setVersion] = useState(null);
  const [direct, setDirect] = useState(false);
  const query = useQuery({
    queryKey: ["organization", root],
    queryFn: () => loadOrganization(root || undefined),
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const draft = data?.draft;
  const actualRoot = data?.root || root;
  const tree = useMemo(() => makeTree(draft), [draft]);
  const node = findNode(tree, folder);
  const folders = useMemo(() => treeRows(tree), [tree]);
  const items = useMemo(
    () =>
      (direct ? node.items : flattenItems(node)).filter(
        (b) =>
          (!reviewOnly || draft.assignments[b.id].review) &&
          (!search ||
            `${b.name} ${draft.assignments[b.id].folder}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [node, draft, reviewOnly, search, direct],
  );
  const subfolders = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
  const showGrid = direct || search || reviewOnly || !subfolders.length;
  const updateCache = (next) =>
    qc.setQueryData(["organization", root], (current) => ({
      ...current,
      draft: next,
    }));
  const perform = async (fn) => {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setWorking(false);
    }
  };
  const generate = (rules) =>
    perform(async () => {
      const next = await generateOrganization({
        root: actualRoot,
        revision: draft?.revision || 0,
        rules,
        previewOnly: Boolean(draft),
      });
      if (draft) {
        setCandidate(next);
        setRulesOpen(false);
        return;
      }
      updateCache(next);
      setRulesOpen(false);
      setSelected(new Set());
      setUndo([]);
      setRedo([]);
      setFolder("");
      setNotice("方案已生成");
    });
  const adjust = (patch) =>
    perform(async () => {
      const before = Object.fromEntries(
        Object.keys(patch).map((id) => [id, draft.assignments[id]]),
      );
      const next = await editOrganization({
        root: actualRoot,
        revision: draft.revision,
        assignments: patch,
      });
      updateCache(next);
      setUndo((list) => [...list.slice(-29), { before, after: patch }]);
      setRedo([]);
      setNotice("草稿已保存");
    });
  const moveSelected = () => {
    if (!target.trim()) return;
    adjust(
      Object.fromEntries(
        [...selected].map((id) => [
          id,
          { folder: target.trim(), manual: true, review: false },
        ]),
      ),
    );
  };
  const travel = (direction) =>
    perform(async () => {
      const source = direction === "undo" ? undo : redo;
      const action = source.at(-1);
      if (!action) return;
      const next = await editOrganization({
        root: actualRoot,
        revision: draft.revision,
        assignments: direction === "undo" ? action.before : action.after,
      });
      updateCache(next);
      if (direction === "undo") {
        setUndo(source.slice(0, -1));
        setRedo((list) => [...list, action]);
      } else {
        setRedo(source.slice(0, -1));
        setUndo((list) => [...list, action]);
      }
    });
  const preview = (snapshotId) =>
    perform(async () => {
      const ready = data.runs?.find(
        (r) =>
          r.status === "ready" &&
          r.snapshotId === snapshotId &&
          (snapshotId || r.revision === draft?.revision),
      );
      if (ready) {
        setHistoryOpen(false);
        setRunId(ready.id);
        return;
      }
      const run = await previewOrganization({
        root: actualRoot,
        revision: draft?.revision,
        snapshotId,
      });
      setHistoryOpen(false);
      setRunId(run.id);
    });
  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const navigate = (p) => {
    setFolder(p);
    setSelected(new Set());
    setSearch("");
    setDirect(false);
  };
  const pendingRun = data?.runs?.find(
    (r) =>
      ["preparing", "applying", "paused"].includes(r.status) ||
      r.interrupted ||
      (r.status === "failed" && r.started),
  );
  const finish = () => {
    setRunId(null);
    setFolder("");
    setSelected(new Set());
    setUndo([]);
    setRedo([]);
    qc.invalidateQueries({ queryKey: ["organization"] });
    qc.invalidateQueries({ queryKey: ["files"] });
  };
  return (
    <div className="org-workspace">
      <div className="org-toolbar">
        <div className="org-heading">
          <FolderTree size={20} />
          <strong>整理</strong>
          <span className="org-draft-badge">目录草稿</span>
        </div>
        <div className="org-toolbar-actions">
          <button
            title="撤销调整"
            aria-label="撤销调整"
            disabled={!undo.length || working}
            onClick={() => travel("undo")}
          >
            <Undo2 size={17} />
          </button>
          <button
            title="重做调整"
            aria-label="重做调整"
            disabled={!redo.length || working}
            onClick={() => travel("redo")}
          >
            <Redo2 size={17} />
          </button>
          <Button
            variant="outline"
            disabled={!actualRoot || working}
            onClick={() => setRulesOpen(true)}
          >
            <Settings2 size={15} />
            整理规则
          </Button>
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History size={15} />
            历史记录
          </Button>
          <Button
            variant="outline"
            disabled={!draft || working}
            onClick={() => setPlanFilesOpen(true)}
          >
            方案文件
          </Button>
          <Button disabled={!draft || working} onClick={() => preview()}>
            {working ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <ArrowRight size={15} />
            )}
            查看变更
          </Button>
        </div>
      </div>
      <div className="org-root-bar">
        <select
          aria-label="整理范围"
          value={actualRoot || ""}
          disabled={working}
          onChange={(e) => {
            setRoot(e.target.value);
            setFolder("");
            setSelected(new Set());
            setUndo([]);
            setRedo([]);
          }}
        >
          {!data?.roots?.length && <option value="">尚未配置扫描目录</option>}
          {data?.roots?.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span>
          {working
            ? "处理中…"
            : notice ||
              (draft ? `${fmt(draft.bundles.length)} 项 · 草稿自动保存` : "")}
        </span>
      </div>
      {(error || query.error) && (
        <div className="org-error" role="alert">
          {error || query.error.message}
          <button
            onClick={() => {
              setError("");
              query.refetch();
            }}
          >
            重新加载
          </button>
        </div>
      )}
      {pendingRun && !runId && (
        <div className="org-warning">
          有一项整理执行需要处理
          <button onClick={() => setRunId(pendingRun.id)}>查看执行</button>
        </div>
      )}
      {draft?.notices?.map((text) => (
        <div className="org-warning" key={text}>
          {text}
        </div>
      ))}
      {query.isPending ? (
        <div className="org-empty">
          <Loader2 className="animate-spin" />
          <p>加载整理工作区</p>
        </div>
      ) : !draft ? (
        <div className="org-empty">
          <div className="org-empty-icon">
            <FolderTree size={38} />
          </div>
          <h2>规划照片的下一套目录</h2>
          <p>按事件、日常、主题和生活散片生成目录草稿。</p>
          <Button
            disabled={!actualRoot || working}
            onClick={() => generate(data.rules)}
          >
            {working ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Folder size={16} />
            )}
            生成整理方案
          </Button>
          <small>
            {actualRoot
              ? "使用所选目录中已扫描的照片和视频"
              : "请先在系统管理中添加扫描目录"}
          </small>
        </div>
      ) : (
        <div className="org-body">
          <aside className="org-sidebar">
            <div className="org-section-title">
              推荐目录
              <span>{fmt(folders.filter((f) => !f.children.size).length)}</span>
            </div>
            <button
              className={`org-tree-row ${!folder ? "active" : ""}`}
              onClick={() => navigate("")}
            >
              <FolderTree size={16} />
              <span>全部目录</span>
              <small>{fmt(tree.count)}</small>
            </button>
            <div className="org-tree-scroll">
              {treeRows(tree, collapsed).map((f) => (
                <div
                  className={`org-tree-row ${folder === f.path ? "active" : ""}`}
                  key={f.path}
                  style={{ paddingLeft: 10 + f.depth * 14 }}
                >
                  <button
                    aria-label={`${collapsed.has(f.path) ? "展开" : "折叠"} ${f.name}`}
                    className="org-expand"
                    disabled={!f.children.size}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(f.path)) next.delete(f.path);
                        else next.add(f.path);
                        return next;
                      })
                    }
                  >
                    {f.children.size ? (
                      collapsed.has(f.path) ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )
                    ) : (
                      <span />
                    )}
                  </button>
                  <button
                    className="org-tree-name"
                    onClick={() => navigate(f.path)}
                    title={f.path}
                  >
                    <Folder size={14} />
                    <span>{f.name}</span>
                    <small>{fmt(f.count)}</small>
                  </button>
                </div>
              ))}
            </div>
            <label className="org-review-toggle">
              <input
                type="checkbox"
                checked={reviewOnly}
                onChange={(e) => setReviewOnly(e.target.checked)}
              />
              待检查<span>{fmt(tree.review)}</span>
            </label>
          </aside>
          <main className="org-content">
            <div className="org-content-header">
              <nav>
                <button onClick={() => navigate("")}>全部目录</button>
                {folder
                  .split("/")
                  .filter(Boolean)
                  .map((part, i, parts) => (
                    <span key={i}>
                      <ChevronRight size={12} />
                      <button
                        onClick={() =>
                          navigate(parts.slice(0, i + 1).join("/"))
                        }
                      >
                        {part}
                      </button>
                    </span>
                  ))}
              </nav>
              <div className="org-content-title">
                <h2>{node.name}</h2>
                <span>{fmt(items.length)} 项</span>
                <label className="org-search">
                  <Search size={15} />
                  <input
                    aria-label="搜索当前目录"
                    placeholder="搜索名称或目录"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="org-content-tools">
                <button
                  onClick={() => setSelected(new Set(items.map((i) => i.id)))}
                >
                  全选
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  disabled={!selected.size}
                >
                  取消选择
                </button>
                {folder && (
                  <button
                    onClick={() => {
                      setSelected(new Set(flattenItems(node).map((i) => i.id)));
                      setTarget(folder);
                    }}
                  >
                    调整此目录
                  </button>
                )}
                {direct && (
                  <button onClick={() => setDirect(false)}>返回子目录</button>
                )}
                {selected.size > 0 && (
                  <strong>已选 {fmt(selected.size)} 项</strong>
                )}
              </div>
            </div>
            {showGrid ? (
              <PhotoGrid
                key={`${folder}/${reviewOnly}`}
                items={items}
                selected={selected}
                onSelect={toggle}
                onOpen={setOpened}
                assignments={draft.assignments}
              />
            ) : (
              <div className="org-folder-grid">
                {subfolders.map((f) => {
                  const photos = flattenItems(f);
                  return (
                    <article key={f.path} className="org-folder-card">
                      <button
                        className="org-folder-cover"
                        onClick={() => navigate(f.path)}
                      >
                        {photos
                          .filter(
                            (_, i) =>
                              i === 0 ||
                              i === Math.floor(photos.length / 2) ||
                              i === photos.length - 1,
                          )
                          .slice(0, 3)
                          .map((p) => (
                            <Photo key={p.id} item={p} />
                          ))}
                      </button>
                      <div className="org-folder-caption">
                        <input
                          aria-label={`选择目录 ${f.name}`}
                          type="checkbox"
                          checked={photos.every((p) => selected.has(p.id))}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              photos.forEach((p) =>
                                checked ? next.add(p.id) : next.delete(p.id),
                              );
                              return next;
                            });
                          }}
                        />
                        <button onClick={() => navigate(f.path)}>
                          <strong>{f.name}</strong>
                          <small>
                            {fmt(f.count)} 项
                            {f.review ? ` · ${fmt(f.review)} 待检查` : ""}
                          </small>
                        </button>
                        <ChevronRight size={15} />
                      </div>
                    </article>
                  );
                })}
                {node.items.length > 0 && (
                  <button
                    className="org-direct-files"
                    onClick={() => setDirect(true)}
                  >
                    查看当前目录的 {node.items.length} 项文件
                  </button>
                )}
              </div>
            )}
          </main>
          {selected.size > 0 && (
            <aside className="org-inspector">
              <div className="org-section-title">
                调整归属
                <button
                  aria-label="取消选择"
                  onClick={() => setSelected(new Set())}
                >
                  <X size={16} />
                </button>
              </div>
              <h3>{fmt(selected.size)} 项已选中</h3>
              <label>
                目标目录
                <input
                  aria-label="目标目录"
                  list="org-folders"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="事件/2021/周末聚会"
                />
              </label>
              <datalist id="org-folders">
                {folders.map((f) => (
                  <option value={f.path} key={f.path} />
                ))}
              </datalist>
              <Button
                disabled={working || !target.trim()}
                onClick={moveSelected}
              >
                移入目录
              </Button>
              <small>输入新路径可新建目录。归属将在重新生成时保留。</small>
              <button
                className="org-inspector-action"
                disabled={working}
                onClick={() =>
                  adjust(
                    Object.fromEntries(
                      [...selected].map((id) => [
                        id,
                        {
                          ...draft.assignments[id],
                          manual: true,
                          review: false,
                        },
                      ]),
                    ),
                  )
                }
              >
                <LockKeyhole size={14} />
                确认当前分组
              </button>
              <button
                className="org-inspector-action"
                disabled={working}
                onClick={() =>
                  adjust(
                    Object.fromEntries(
                      [...selected].map((id) => [
                        id,
                        { ...draft.assignments[id], manual: false },
                      ]),
                    ),
                  )
                }
              >
                <RotateCcw size={14} />
                允许重新分组
              </button>
            </aside>
          )}
        </div>
      )}
      {planFilesOpen && (
        <PlanFileDialog
          root={actualRoot}
          onClose={() => setPlanFilesOpen(false)}
          onImport={async (plan) => {
            const next = await importOrganization({
              root: actualRoot,
              revision: draft.revision,
              plan,
            });
            setCandidate(next);
            setPlanFilesOpen(false);
          }}
        />
      )}
      {candidate && (
        <Dialog open onOpenChange={(open) => !open && setCandidate(null)}>
          <DialogContent className="org-dialog org-run-dialog">
            <DialogTitle>新方案已生成</DialogTitle>
            <DialogDescription>
              {fmt(
                candidate.draft.bundles.filter(
                  (b) =>
                    draft.assignments[b.id]?.folder !==
                    candidate.draft.assignments[b.id]?.folder,
                ).length,
              )}{" "}
              项归属变化 · 手动调整已保留
            </DialogDescription>
            <div className="org-diff">
              {candidate.draft.bundles
                .filter(
                  (b) =>
                    draft.assignments[b.id]?.folder !==
                    candidate.draft.assignments[b.id]?.folder,
                )
                .slice(0, 100)
                .map((b) => (
                  <div key={b.id}>
                    <span>
                      {b.name} · {draft.assignments[b.id]?.folder || "新增"}
                    </span>
                    <strong>{candidate.draft.assignments[b.id].folder}</strong>
                  </div>
                ))}
            </div>
            <div className="org-dialog-actions">
              <Button variant="outline" onClick={() => setCandidate(null)}>
                保留原方案
              </Button>
              <Button
                disabled={working}
                onClick={() =>
                  perform(async () => {
                    const next = await acceptOrganization({
                      root: actualRoot,
                      candidateId: candidate.candidateId,
                    });
                    updateCache(next);
                    setCandidate(null);
                    setFolder("");
                    setSelected(new Set());
                    setUndo([]);
                    setRedo([]);
                    setNotice("新方案已保存");
                  })
                }
              >
                采用新方案
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {version && (
        <SnapshotBrowser
          root={actualRoot}
          version={version}
          onClose={() => setVersion(null)}
        />
      )}
      {rulesOpen && (
        <RulesDialog
          initial={draft?.rules || data.rules}
          onClose={() => setRulesOpen(false)}
          onGenerate={generate}
          working={working}
        />
      )}
      {runId && (
        <RunDialog
          root={actualRoot}
          runId={runId}
          onClose={() => {
            setRunId(null);
            query.refetch();
          }}
          onFinished={finish}
        />
      )}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="org-dialog">
          <DialogTitle>整理记录</DialogTitle>
          <DialogDescription>每次应用和恢复都会记录目录状态</DialogDescription>
          <div className="org-history-list">
            {!data?.history?.length && <p>尚未应用过整理方案</p>}
            {data?.history?.map((h, i) => (
              <div key={h.id}>
                <span className="org-history-dot" />
                <section>
                  <strong>{h.label}</strong>
                  <small>
                    {time(h.createdAt)} · {fmt(h.files)} 个文件
                  </small>
                  {i === 0 && <small>最近记录</small>}
                </section>
                <button
                  onClick={() => {
                    setHistoryOpen(false);
                    setVersion(h);
                  }}
                >
                  查看目录
                </button>
                <Button
                  variant="outline"
                  disabled={working}
                  onClick={() => preview(h.snapshotId)}
                >
                  预览恢复
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!opened} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="org-dialog org-image-dialog">
          <DialogTitle>{opened?.name}</DialogTitle>
          <DialogDescription>
            {opened && draft?.assignments[opened.id]?.reason} ·{" "}
            {date(opened?.time)}
          </DialogDescription>
          {opened && (
            <>
              <div className="org-large-image">
                <Photo item={opened} large />
              </div>
              <div className="org-image-meta">
                <span>{opened.camera}</span>
                <span>{draft?.assignments[opened.id]?.folder}</span>
              </div>
              {opened.gps && (
                <div className="org-name-place">
                  <MapPin size={15} />
                  <input
                    aria-label="地点名称"
                    placeholder="为此区域命名，例如：昆明"
                    value={placeName}
                    onChange={(e) => setPlaceName(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!placeName.trim() || working}
                    onClick={() => {
                      generate({
                        ...draft.rules,
                        places: [
                          ...draft.rules.places,
                          {
                            name: placeName.trim(),
                            ...opened.gps,
                            radiusKm: 5,
                          },
                        ],
                      });
                      setOpened(null);
                      setPlaceName("");
                    }}
                  >
                    命名附近 5 km
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
