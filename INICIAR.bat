@echo off
chcp 65001 >nul
title PIVOT Deal Manager - WEB
color 0A
cls

echo.
echo ========================================
echo  PIVOT Deal Manager - Sistema WEB
echo ========================================
echo.

REM Verifica se Node.js está instalado
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js NÃO está instalado!
    echo.
    echo Você precisa instalar Node.js antes de continuar.
    echo.
    echo Baixe aqui: https://nodejs.org/
    echo.
    echo Após instalar, execute este script novamente.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js instalado
node --version
echo.

REM Verifica se node_modules existe, se não instala
if not exist node_modules (
    echo [1/3] Instalando dependências (primeira vez)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao instalar dependências!
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependências instaladas
    echo.
) else (
    echo [1/3] Dependências já instaladas
    echo.
)

REM Verifica se package.json existe
if not exist package.json (
    echo [ERRO] package.json não encontrado!
    echo Este script deve estar na pasta "pivot-web"
    pause
    exit /b 1
)

REM Inicia o servidor
echo [2/3] Iniciando servidor...
echo.

REM Abre o navegador em background
echo [3/3] Abrindo navegador...
timeout /t 2 >nul
start http://localhost:3000

echo.
echo ========================================
echo  ✅ SERVIDOR INICIADO COM SUCESSO!
echo ========================================
echo.
echo 🌐 Acesse: http://localhost:3000
echo.
echo 📧 Login:
echo    Email: silvio@pivot.com
echo    Senha: 123456
echo.
echo ⚠️  NÃO FECHE ESTA JANELA
echo    (Fechar desliga o servidor)
echo.
echo Pressione Ctrl+C para parar o servidor
echo.

npm start
