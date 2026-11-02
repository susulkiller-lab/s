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
rem Find a real Python. Prefer 3.13 (the tested version). Every candidate is actually run,
rem so the Microsoft Store "python" stub (which exists even when Python is not installed) is ignored.
set "PY="
for %%V in (3.13 3.12 3.11 3.14) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  py -3 -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)" >nul 2>nul && set "PY=py -3"
)
rem Python installed without PATH or the py launcher: look in the standard install folders.
if not defined PY if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set PY="%LocalAppData%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set PY="%LocalAppData%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set PY="%LocalAppData%\Programs\Python\Python311\python.exe"
if not defined PY if exist "%ProgramFiles%\Python313\python.exe" set PY="%ProgramFiles%\Python313\python.exe"
if not defined PY if exist "%ProgramFiles%\Python312\python.exe" set PY="%ProgramFiles%\Python312\python.exe"
if not defined PY if exist "%ProgramFiles%\Python311\python.exe" set PY="%ProgramFiles%\Python311\python.exe"
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)" >nul 2>nul && set "PY=python"
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
echo.
echo Python is not installed on this PC.
echo (The "python" shortcut that Windows offers via the Microsoft Store does not count.)
echo.
echo 1. A download page is opening. Get "Windows installer (64-bit)" for Python 3.13.
echo 2. In the installer, check "Add python.exe to PATH" on the first screen, then click Install Now.
echo 3. When it finishes, close this window and double-click pdf2md.bat again.
echo.
start "" "https://www.python.org/downloads/"
pause
exit /b 1
