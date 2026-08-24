@echo off
setlocal
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\auto-commit-push.mjs
