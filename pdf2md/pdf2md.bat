@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  set "PY="
  where py >nul 2>nul && set "PY=py -3"
  if not defined PY (
    where python >nul 2>nul && set "PY=python"
  )
  if not defined PY (
    echo Python 3.10 or later is required.
    echo Install it from https://www.python.org/downloads/ and check "Add python.exe to PATH".
    pause
    exit /b 1
  )
  %PY% pdf2md.py --setup
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

".venv\Scripts\python.exe" pdf2md.py %*
if not "%~1"=="" pause
