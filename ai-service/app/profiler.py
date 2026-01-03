"""input: FastAPI Request + Python runtime(time/resource)
output: 轻量 profiling（分段耗时 + CPU 时间 + RSS 峰值），可附带到响应中
pos: AI service 工具层：为推理接口提供可观测性（变更需同步更新本头注释与所属目录 README）
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _now_ns() -> int:
    return time.perf_counter_ns()


def _cpu_ns() -> int:
    # process_time_ns ~= 当前进程 CPU 时间（不含 sleep/wait）
    return time.process_time_ns()


def _rss_kb_max() -> Optional[int]:
    # ru_maxrss: macOS -> bytes; Linux -> KB. Normalize to KB best-effort.
    try:
        import resource  # stdlib

        v = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        # Heuristic: if it's "too large" it's probably bytes.
        if v > 10_000_000:  # > ~10GB in KB, or > ~10MB in bytes
            return v // 1024
        return v
    except (ImportError, AttributeError, ValueError, OSError):
        return None


@dataclass
class Step:
    name: str
    ms: float
    cpu_ms: float
    rss_max_kb: Optional[int] = None
    extra: Optional[Dict[str, Any]] = None


@dataclass
class Profiler:
    name: str
    request_id: str
    enabled: bool = True
    _t0: int = field(default_factory=_now_ns)
    _c0: int = field(default_factory=_cpu_ns)
    _last_t: int = field(default_factory=_now_ns)
    _last_c: int = field(default_factory=_cpu_ns)
    steps: List[Step] = field(default_factory=list)

    def mark(self, step_name: str, extra: Optional[Dict[str, Any]] = None) -> None:
        if not self.enabled:
            return
        t1 = _now_ns()
        c1 = _cpu_ns()
        ms = (t1 - self._last_t) / 1e6
        cpu_ms = (c1 - self._last_c) / 1e6
        self.steps.append(Step(name=str(step_name), ms=ms, cpu_ms=cpu_ms, rss_max_kb=_rss_kb_max(), extra=extra))
        self._last_t = t1
        self._last_c = c1

    def wrap(self, step_name: str, fn, extra: Optional[Dict[str, Any]] = None):
        if not self.enabled:
            return fn()
        t0 = _now_ns()
        c0 = _cpu_ns()
        try:
            out = fn()
            t1 = _now_ns()
            c1 = _cpu_ns()
            self.steps.append(
                Step(
                    name=str(step_name),
                    ms=(t1 - t0) / 1e6,
                    cpu_ms=(c1 - c0) / 1e6,
                    rss_max_kb=_rss_kb_max(),
                    extra=extra,
                )
            )
            self._last_t = t1
            self._last_c = c1
            return out
        except Exception as e:
            t1 = _now_ns()
            c1 = _cpu_ns()
            ex = dict(extra or {})
            ex["error"] = str(getattr(e, "detail", None) or str(e))
            self.steps.append(
                Step(
                    name=str(step_name),
                    ms=(t1 - t0) / 1e6,
                    cpu_ms=(c1 - c0) / 1e6,
                    rss_max_kb=_rss_kb_max(),
                    extra=ex,
                )
            )
            self._last_t = t1
            self._last_c = c1
            raise

    def finish(self, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.enabled:
            return {}
        self.mark("end", extra=extra)
        total_ms = (self._last_t - self._t0) / 1e6
        total_cpu_ms = (self._last_c - self._c0) / 1e6
        return {
            "name": self.name,
            "requestId": self.request_id,
            "totalMs": total_ms,
            "totalCpuMs": total_cpu_ms,
            "rssMaxKb": _rss_kb_max(),
            "steps": [
                {
                    "name": s.name,
                    "ms": s.ms,
                    "cpuMs": s.cpu_ms,
                    "rssMaxKb": s.rss_max_kb,
                    "extra": s.extra,
                }
                for s in self.steps
            ],
        }


