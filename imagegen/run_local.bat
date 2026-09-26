@echo off
REM bloo imagegen - backup runner for Cris's PC. Loops forever: run, then sleep until
REM there is work AND a provider/plate is available (reads quota state from Supabase).
REM Secrets: put KEY=VALUE lines in imagegen\.env.local (gitignored). Never commit it.
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating venv...
  python -m venv .venv || goto :fail
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt || goto :fail
)

if exist ".env.local" (
  for /f "usebackq eol=# tokens=1* delims==" %%A in (".env.local") do set "%%A=%%B"
) else (
  echo Missing imagegen\.env.local with CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY and provider keys.
  goto :fail
)

:loop
echo [%date% %time%] running worker...
".venv\Scripts\python.exe" -m imagegen.run --max-jobs 12 --max-minutes 20
set "WAIT=1800"
for /f %%W in ('".venv\Scripts\python.exe" -m imagegen.run --next-wait') do set "WAIT=%%W"
echo [%date% %time%] sleeping %WAIT% s (Ctrl+C to stop)
timeout /t %WAIT% /nobreak >nul
goto loop

:fail
echo imagegen setup failed.
pause
exit /b 1
