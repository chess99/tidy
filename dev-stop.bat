@echo off
echo Stopping development servers...
echo.

REM Kill Node processes (this will stop both frontend and backend)
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM nodemon.exe >nul 2>&1

echo Development servers stopped.
pause

