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
rem Prefer 3.13 (the tested version). Newer Pythons may lack wheels for the OCR engine.
set "PY="
for %%V in (3.13 3.12 3.11 3.14) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  where py >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY goto nopython
echo Setting up with: %PY%
echo This takes a few minutes and needs internet.
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
echo Python 3.13 (64-bit) is required.
echo Install it from https://www.python.org/downloads/ and check "Add python.exe to PATH".
pause
exit /b 1
