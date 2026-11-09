"""Start the packaged sidecar and verify its health without loading model weights."""

import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def main():
    binary = Path(sys.argv[1]).resolve()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(binary), "--host", "127.0.0.1", "--port", str(port)],
            stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        health = json.load(response)
                    if not health.get("ok") or health.get("service") != "tidy-ai-service":
                        raise RuntimeError(f"unexpected health response: {health}")
                    for name in ("faces", "clip"):
                        if not health.get("capabilities", {}).get(name, {}).get("available"):
                            raise RuntimeError(f"packaged {name} capability unavailable: {health}")
                    print("Packaged AI service: health, faces and CLIP imports passed")
                    return
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.2)
            log.seek(0)
            raise RuntimeError(f"packaged AI service did not become ready:\n{log.read()[-6000:]}")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
