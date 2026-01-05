"""input: 环境变量/CLI 参数（host/port/日志）+ FastAPI app（app.main）+ uvicorn
output: 启动本地 HTTP 推理服务进程（提供 /health、/detect+embed、/clip/*）
pos: ai-service 可执行入口：用于 PyInstaller 打包与桌面壳拉起（变更需同步更新本头注释与所属目录 README）
"""

import argparse
import os


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="tidy-ai-service")
    p.add_argument("--host", default=str(os.environ.get("TIDY_AI_HOST", "127.0.0.1")).strip() or "127.0.0.1")
    p.add_argument("--port", type=int, default=int(str(os.environ.get("TIDY_AI_PORT", "8002")).strip() or "8002"))
    p.add_argument("--log-level", default=str(os.environ.get("TIDY_AI_LOG_LEVEL", "info")).strip() or "info")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    from app.main import app  # local import: keep startup path explicit
    try:
        import uvicorn  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"uvicorn import failed: {e}") from e

    uvicorn.run(app, host=args.host, port=int(args.port), log_level=args.log_level)


if __name__ == "__main__":
    main()


