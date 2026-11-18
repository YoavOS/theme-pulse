@echo off
title Theme Pulse - stopping
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local\Stop-ThemePulse.ps1"
