@echo off
title PIVOT - Push para GitHub
cd /d "%~dp0"
echo ============================================
echo   Enviando para github.com/TLopes81/vendas_pivot
echo ============================================
echo.
if not exist .git (
  git init
  git branch -M main
)
git add .
git commit -m "Initial commit: PIVOT Deal Manager WEB" 2>nul
git remote remove origin 2>nul
git remote add origin https://github.com/TLopes81/vendas_pivot.git
git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo FALHA no push. Ver SOLUCIONAR_ERROS.md
) else (
  echo.
  echo Push concluido: https://github.com/TLopes81/vendas_pivot
)
pause
