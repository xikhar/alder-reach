@echo off
cd /d "%~dp0"
node scripts\play.mjs --open
if errorlevel 1 pause
