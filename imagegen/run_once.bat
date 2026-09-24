@echo off
REM bloo imagegen - ONE bounded pass, for Windows Task Scheduler (e.g. every 30 min).
REM Exits fast when nothing is pending. Exit code: 0 ok (incl. nothing pending / quota wait),
REM 2 missing config, 1 crash. Secrets: KEY=VALUE lines in imagegen\.env.local (gitignored).
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "logs" mkdir logs

if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv || exit /b 2
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || exit /b 2
)
if not exist ".env.local" (
  echo [%date% %time%] missing imagegen\.env.local>> "logs\worker.log"
  exit /b 2
)
for /f "usebackq eol=# tokens=1* delims==" %%A in (".env.local") do set "%%A=%%B"
REM IP-scoped quotas (anonymous ZeroGPU) are tracked per host in state/providers.json
if not defined RUNNER_KIND set "RUNNER_KIND=local"

".venv\Scripts\python.exe" -m imagegen.run --once --max-jobs 12 --max-minutes 25 >> "logs\worker.log" 2>&1
exit /b %ERRORLEVEL%
