#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install --only-binary=:all: -r requirements.txt
python -m pip install --only-binary=:all: pyinstaller
python -m pip check

rm -rf dist build

# onedir: more reliable for heavy deps (torch/onnxruntime/opencv)
pyinstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name tidy-ai-service \
  app/entrypoint.py

OUT_DIR="$(pwd)/dist/tidy-ai-service"

# macOS: fix OpenSSL dylib mismatch.
# - Python _ssl in our environment links against OpenSSL provided by Homebrew openssl@3
# - OpenCV wheels also bundle libssl/libcrypto, but the symbol set can mismatch and crash at import time.
# Strategy:
# - delete OpenCV-bundled libssl/libcrypto
# - copy the OpenSSL dylibs that match Python's _ssl into _internal (used via @rpath)
if [[ "$(uname -s)" == "Darwin" ]]; then
  CV2_SSL_DIR="$OUT_DIR/_internal/cv2/.dylibs"
  rm -f "$CV2_SSL_DIR/libssl.3.dylib" "$CV2_SSL_DIR/libcrypto.3.dylib" || true

  if [[ -f "/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib" ]]; then
    OPENSSL_LIB="/opt/homebrew/opt/openssl@3/lib"
  elif [[ -f "/usr/local/opt/openssl@3/lib/libssl.3.dylib" ]]; then
    OPENSSL_LIB="/usr/local/opt/openssl@3/lib"
  else
    echo "ERROR: cannot find Homebrew openssl@3 dylibs (libssl.3.dylib/libcrypto.3.dylib)." >&2
    echo "Hint: install via Homebrew: brew install openssl@3" >&2
    exit 1
  fi

  cp -f "$OPENSSL_LIB/libssl.3.dylib" "$OUT_DIR/_internal/libssl.3.dylib"
  cp -f "$OPENSSL_LIB/libcrypto.3.dylib" "$OUT_DIR/_internal/libcrypto.3.dylib"
fi

echo "Built: $OUT_DIR/"

