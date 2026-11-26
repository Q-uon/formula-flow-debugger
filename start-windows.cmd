@echo off
setlocal
cd /d "%~dp0"
title Formula Flow Debugger

echo ========================================
echo  Formula Flow Debugger - Windows start
echo ========================================
echo.

where py >nul 2>&1
if not errorlevel 1 goto use_py
where python >nul 2>&1
if not errorlevel 1 goto use_python

echo [ERROR] Python 3 was not found.
echo Install Python 3 from Microsoft Store or python.org, then run this file again.
echo OpenSSL, Node.js, npm, and PATH settings for OpenSSL are NOT required.
pause
exit /b 1

:use_py
py -3 server.py --trust-cert --open-browser
set EXIT_CODE=%ERRORLEVEL%
goto finished

:use_python
python server.py --trust-cert --open-browser
set EXIT_CODE=%ERRORLEVEL%

:finished
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. See the message above and README.md.
  pause
)
exit /b %EXIT_CODE%
