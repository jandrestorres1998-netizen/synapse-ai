@echo off
setlocal enabledelayedexpansion
title SynapseAI Control Plane Launcher
color 0B
chcp 65001 >nul

:: Crucial: ensure working directory is always the folder where this batch script lives
cd /d "%~dp0"

echo ==============================================================================
echo                      SYNAPSE AI - THE LOCAL-FIRST AI SHIELD
echo ==============================================================================
echo.
echo [1/3] Verificando entorno de ejecucion...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado o no se encuentra en el PATH del sistema.
    echo Por favor descarga e instala Node.js LTS desde: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js detectado correctamente.
echo.

echo [2/3] Verificando dependencias locales en %~dp0...
if not exist "node_modules\" (
    echo Instalando dependencias de produccion...
    call npm.cmd install --omit=dev
)
echo [OK] Dependencias listas.
echo.

if not exist "server\server.js" (
    echo [ERROR] No se encontro el archivo server\server.js en el directorio:
    echo %~dp0
    echo.
    pause
    exit /b 1
)

echo [3/3] Iniciando Gateway Local y Dashboard en http://localhost:3000 ...
echo.
echo ==============================================================================
echo  - Dashboard Web:        http://localhost:3000
echo  - OpenAI Endpoint:      http://localhost:3000/v1/chat/completions
echo  - Proteccion DLP:       ACTIVA (RAM-Only)
echo  - Boveda AES-256:       ACTIVA (Hardware-Bound)
echo ==============================================================================
echo.
echo Abriendo el panel de control en tu navegador predeterminado...
start http://localhost:3000

echo.
echo El servidor esta ejecutandose. Presiona CTRL + C cuando desees detenerlo.
echo.
node server/server.js

pause
