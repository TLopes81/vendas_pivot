@echo off
chcp 65001 >nul
title Push para GitHub

echo.
echo ========================================
echo  Enviando código para GitHub
echo ========================================
echo.

REM Verifica se git está instalado
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Git não está instalado!
    echo.
    echo Baixe em: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo [OK] Git encontrado
echo.

REM Adiciona remote
echo [1/3] Adicionando repositório remoto...
git remote add origin https://github.com/TLopes81/vendas_pivot.git
if errorlevel 1 (
    echo [AVISO] Remote pode já estar configurado
)

REM Renomeia branch para main
echo [2/3] Configurando branch...
git branch -M main

REM Faz push
echo [3/3] Enviando código para GitHub...
echo.
git push -u origin main

if errorlevel 0 (
    echo.
    echo ========================================
    echo  ✅ SUCESSO!
    echo ========================================
    echo.
    echo Seu código está em:
    echo https://github.com/TLopes81/vendas_pivot
    echo.
) else (
    echo.
    echo [ERRO] Falha ao fazer push!
    echo.
)

pause
