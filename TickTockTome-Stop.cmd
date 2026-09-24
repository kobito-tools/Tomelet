@echo off
cd /d "%~dp0"
node scripts\stop.js
timeout /t 1 /nobreak >nul
