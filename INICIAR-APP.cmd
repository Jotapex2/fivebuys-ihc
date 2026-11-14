@echo off
setlocal
title FiveBuys
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\iniciar-app.ps1"
if errorlevel 1 pause
