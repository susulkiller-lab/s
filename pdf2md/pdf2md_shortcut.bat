@echo off
setlocal
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"

rem Creates the "PDF" shortcut (with icon) on the Desktop and in this folder. Needs only a plain Python.
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" pdf2md.py --shortcut
  goto done
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 pdf2md.py --shortcut
  goto done
)
where python >nul 2>nul
if not errorlevel 1 (
  python pdf2md.py --shortcut
  goto done
)
echo Python was not found. Run pdf2md.bat first (it installs everything), then run this again.

:done
pause
