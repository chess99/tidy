import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, Image } from "lucide-react";
import { getDirectorySnapshot } from "../../api/organization";
import { apiUrl } from "../../api/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

export function SnapshotBrowser({ root, version, onClose }) {
  const [folder, setFolder] = useState("");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["directory-snapshot", root, version.snapshotId],
    queryFn: () => getDirectorySnapshot(root, version.snapshotId),
  });
  const prefix = folder ? folder + "/" : "";
  const files = (query.data?.files || []).filter(
    (f) =>
      f.relative.startsWith(prefix) &&
      !f.relative.slice(prefix.length).includes("/"),
  );
  const dirs = (query.data?.directories || []).filter(
    (d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/"),
  );
  const navigate = (name) => {
    setFolder(name);
    setPage(0);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="org-dialog org-snapshot-dialog">
        <DialogTitle>{version.label}</DialogTitle>
        <DialogDescription>
          {new Date(version.createdAt).toLocaleString("zh-CN")} · 历史目录
        </DialogDescription>
        <nav className="org-snapshot-nav">
          <button onClick={() => navigate("")}>根目录</button>
          {folder
            .split("/")
            .filter(Boolean)
            .map((p, i, all) => (
              <span key={i}>
                <ChevronRight size={13} />
                <button onClick={() => navigate(all.slice(0, i + 1).join("/"))}>
                  {p}
                </button>
              </span>
            ))}
        </nav>
        {query.error && <p role="alert">{query.error.message}</p>}
        <div className="org-snapshot-files">
          {query.isPending ? (
            <p>读取目录…</p>
          ) : (
            <>
              {dirs.map((d) => (
                <button key={d} onClick={() => navigate(d)}>
                  <Folder size={20} />
                  <span>{d.slice(prefix.length)}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {files.slice(page * 100, (page + 1) * 100).map((f) => (
                <div key={f.relative}>
                  <span className="org-snapshot-thumb">
                    <img
                      loading="lazy"
                      src={apiUrl(`/assets/${f.hash}/thumb`)}
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <Image size={16} />
                  </span>
                  <span>{f.relative.slice(prefix.length)}</span>
                  <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                </div>
              ))}
              {!dirs.length && !files.length && <p>空目录</p>}
            </>
          )}
        </div>
        <div className="org-dialog-actions">
          <span>
            {files.length} 个文件 · {dirs.length} 个目录
          </span>
          {files.length > 100 && (
            <div>
              <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span>
                {page + 1} / {Math.ceil(files.length / 100)}
              </span>
              <button
                disabled={(page + 1) * 100 >= files.length}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
