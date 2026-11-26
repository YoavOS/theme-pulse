@echo off
title Theme Pulse - starting
echo Starting Theme Pulse. Please keep this window open until your browser opens.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local\Start-ThemePulse.ps1"
if errorlevel 1 (
  echo.
  echo Theme Pulse could not start. The error above and local\logs explain why.
  pause
  exit /b 1
)
