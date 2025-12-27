@echo off
echo Starting development servers...
echo.

cd /d %~dp0

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

