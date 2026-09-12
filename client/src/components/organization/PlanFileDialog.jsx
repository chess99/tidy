import { useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import { exportOrganization } from "../../api/organization";

export function PlanFileDialog({ root, onImport, onClose }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const work = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  };
  const download = (type) =>
    work(async () => {
      const data = await exportOrganization(root, type);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `tidy-${type}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="org-dialog">
        <DialogTitle>方案文件</DialogTitle>
        <DialogDescription>
          导出素材清单与目录方案，或导入外部生成的分组
        </DialogDescription>
        {error && (
          <div className="org-error" role="alert">
            {error}
          </div>
        )}
        <div className="org-plan-file-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => download("catalog")}
          >
            导出素材清单
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => download("plan")}
          >
            导出当前方案
          </Button>
        </div>
        <label className="org-plan-file-input">
          导入方案 JSON
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              work(async () => {
                if (file.size > 8 * 1024 * 1024)
                  throw new Error("方案文件不能超过 8 MB");
                const plan = JSON.parse(await file.text());
                await onImport(plan);
              });
              e.target.value = "";
            }}
          />
        </label>
        <small>导入后先检查归属差异，采用方案不会移动文件。</small>
      </DialogContent>
    </Dialog>
  );
}
