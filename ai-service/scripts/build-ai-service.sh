#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install pyinstaller

rm -rf dist build

# onedir: more reliable for heavy deps (torch/onnxruntime/opencv)
pyinstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name tidy-ai-service \
  app/entrypoint.py

echo "Built: $(pwd)/dist/tidy-ai-service/"


