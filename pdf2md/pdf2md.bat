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
rem Find a real Python (3.10 to 3.14). Prefer 3.13 (the tested version). Every candidate is actually run,
rem so the Microsoft Store "python" stub (which exists even when Python is not installed) is ignored.
set "PY="
for %%V in (3.13 3.12 3.11 3.14) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  py -3 -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)" >nul 2>nul && set "PY=py -3"
)
rem Python installed without PATH or the py launcher: look in the standard install folders.
if not defined PY if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set PY="%LocalAppData%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set PY="%LocalAppData%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set PY="%LocalAppData%\Programs\Python\Python311\python.exe"
if not defined PY if exist "%ProgramFiles%\Python313\python.exe" set PY="%ProgramFiles%\Python313\python.exe"
if not defined PY if exist "%ProgramFiles%\Python312\python.exe" set PY="%ProgramFiles%\Python312\python.exe"
if not defined PY if exist "%ProgramFiles%\Python311\python.exe" set PY="%ProgramFiles%\Python311\python.exe"
if not defined PY (
  python -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)" >nul 2>nul && set "PY=python"
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
echo No usable Python was found. This tool is tested with Python 3.13.
echo - Python 3.15 or newer cannot be used yet (the OCR engine has no package for it).
echo - The "python" shortcut offered by the Microsoft Store does not count.
echo.
echo A download page is opening. In the "Stable Releases" list choose "Python 3.13.x",
echo then "Download Windows installer (64-bit)". In the installer, check "Add python.exe to PATH".
echo Your current Python can stay installed. When the install finishes, double-click pdf2md.bat again.
echo.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1
