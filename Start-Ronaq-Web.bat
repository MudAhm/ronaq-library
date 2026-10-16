@echo off
chcp 65001 >nul
cd /d "%~dp0"
title المكتبة الرونق — Web (Turso)
if not exist "node_modules\@libsql\client" (
  echo Installing dependencies...
  call npm install
)
if exist ".env.turso" (
  echo Using Turso cloud database from .env.turso
) else (
  echo WARNING: .env.turso missing — will try local SQLite
)
echo Starting on http://127.0.0.1:8787 ...
node server.mjs
if errorlevel 1 pause
