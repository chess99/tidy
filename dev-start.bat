@echo off
echo Starting development servers...
echo.

cd /d %~dp0

echo Starting AI service...
if exist "ai-service\.venv\Scripts\python.exe" (
  start "AI Service" cmd /k "cd ai-service && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8002"
) else (
  echo [AI] ai-service venv missing. Run:
  echo   cd ai-service ^&^& python -m venv .venv ^&^& .venv\\Scripts\\python -m pip install -r requirements.txt
)

echo Starting backend server...
start "Backend Server" cmd /k "cd server && npm run dev"

timeout /t 2 /nobreak >nul

echo Starting frontend server...
start "Frontend Server" cmd /k "cd client && npm run dev"

echo.
echo Both servers are starting in separate windows.
echo Close those windows to stop the servers.
echo.
pause

