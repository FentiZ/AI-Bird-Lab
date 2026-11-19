@echo off
cd /d "%~dp0"
if not exist .env (
    copy .env.example .env
    echo Edit .env before using this project! Make passwords and keys your own.
    notepad .env
)
docker compose up --build -d
if errorlevel 1 (
    echo Docker Compose failed; check Docker Desktop and docker compose logs.
    pause
    exit /b 1
)
echo Web: http://localhost:5173
echo API: http://localhost:5080/api/health
pause
