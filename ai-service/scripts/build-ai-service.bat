@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

python -m venv .venv
call .venv\Scripts\activate.bat

python -m pip install --upgrade pip
python -m pip install --only-binary=:all: -r requirements.txt
python -m pip install --only-binary=:all: pyinstaller
python -m pip check

if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM onedir: more reliable for heavy deps (torch/onnxruntime/opencv)
pyinstaller --noconfirm --clean --onedir --name tidy-ai-service app\entrypoint.py

echo Built: %cd%\dist\tidy-ai-service\

