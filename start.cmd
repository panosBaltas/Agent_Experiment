@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Command "try { if ((Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 2).name -eq 'Common Ground') { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
    start "" "http://127.0.0.1:8765"
    exit /b 0
)
python server.py --open
if errorlevel 1 pause
