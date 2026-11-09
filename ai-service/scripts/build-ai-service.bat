@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0\.."

python -m venv .venv || exit /b 1
call .venv\Scripts\activate.bat || exit /b 1

python -m pip install --upgrade pip || exit /b 1
REM CPU wheels keep the standalone Windows service independent of CUDA.
python -m pip install --only-binary=:all: torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu || exit /b 1
python -m pip install --only-binary=:all: -r requirements.txt || exit /b 1
python -m pip install --only-binary=:all: pyinstaller || exit /b 1
python -m pip check || exit /b 1

if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM onedir: more reliable for heavy deps (torch/onnxruntime/opencv)
pyinstaller --noconfirm --clean --onedir --name tidy-ai-service app\entrypoint.py || exit /b 1

echo Built: %cd%\dist\tidy-ai-service\

