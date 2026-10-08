@echo off
title PIVOT Deal Manager WEB
cd /d "%~dp0"
echo ============================================
echo   PIVOT Deal Manager WEB - iniciando...
echo ============================================
echo.
if not exist node_modules (
  echo Instalando dependencias (primeira execucao)...
  call npm install
  echo.
)
echo Servidor em http://localhost:3000
echo Login: silvio@pivot.com / 123456
echo.
start "" http://localhost:3000
call npm start
pause
