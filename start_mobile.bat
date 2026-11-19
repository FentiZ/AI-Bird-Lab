@echo off
cd /d "%~dp0mobile"
if not exist node_modules call npm install
if errorlevel 1 (pause & exit /b 1)
call npx expo install --fix
if errorlevel 1 (pause & exit /b 1)
call npx expo start --lan
pause
