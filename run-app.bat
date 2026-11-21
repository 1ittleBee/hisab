@echo off
title Basa Vara & Mess Hisab
cd /d "%~dp0hisab-app"

echo ========================================================
echo   Starting Basa Vara & Mess Hisab (বাসা ভাড়া হিসাব)...
echo ========================================================
echo.
echo Open this URL in your browser:
echo   http://localhost:5173
echo.
echo Press Ctrl+C in this window anytime to stop the server.
echo.

start http://localhost:5173
npx vite --host 127.0.0.1 --port 5173
pause
