@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"

rem Skip setup only when the venv exists AND the required packages are importable.
set "NEED=0"
if not exist ".venv\Scripts\python.exe" set "NEED=1"
if "%NEED%"=="1" goto setup
".venv\Scripts\python.exe" -c "import sys,importlib.util as u; sys.exit(0 if all(u.find_spec(m) for m in ('markitdown','pypdfium2','rapidocr')) else 1)" >nul 2>nul
if errorlevel 1 goto setup
goto run

:setup
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY goto nopython
echo Setting up (first run or repair). This takes a few minutes and needs internet.
%PY% pdf2md.py --setup
if errorlevel 1 (
  pause
  exit /b 1
)

:run
".venv\Scripts\python.exe" pdf2md.py %*
if not "%~1"=="" pause
exit /b 0

:nopython
echo Python 3.10 or later is required.
echo Install it from https://www.python.org/downloads/ and check "Add python.exe to PATH".
pause
exit /b 1
