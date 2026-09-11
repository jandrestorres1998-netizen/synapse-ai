@echo off
setlocal enabledelayedexpansion
title SynapseAI — Instalador para Windows
color 0B
chcp 65001 >nul

cd /d "%~dp0"

echo ==============================================================================
echo                 SYNAPSE AI — INSTALACIÓN AUTOMÁTICA EN WINDOWS
echo ==============================================================================
echo.
echo Este asistente dejará SynapseAI funcionando como servicio en segundo plano
echo y configurará el inicio automático cada vez que enciendas tu ordenador.
echo.

:: 1. Comprobar Node.js
echo [1/4] Comprobando entorno de Windows...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [AVISO] Node.js no está instalado en este equipo.
    echo Intentando instalar Node.js LTS automáticamente mediante Windows Package Manager (winget)...
    winget install OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudo instalar Node.js de forma automática.
        echo Por favor descarga el instalador oficial desde https://nodejs.org/ e inténtalo de nuevo.
        pause
        exit /b 1
    )
    echo [OK] Node.js instalado con éxito.
) else (
    echo [OK] Node.js detectado correctamente.
)

:: 2. Instalar dependencias si no existen
echo [2/4] Verificando dependencias del programa...
if not exist "node_modules\" (
    echo Instalando componentes necesarios en segundo plano...
    call npm.cmd install --omit=dev --no-audit --no-fund
)
if not exist "data\" mkdir data
echo [OK] Componentes listos.

:: 3. Configurar inicio automático con Windows y acceso directo en el Escritorio
echo [3/4] Creando accesos directos e inicio automático...

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$startup = [Environment]::GetFolderPath('Startup'); " ^
  "$sc = $ws.CreateShortcut(\"$startup\SynapseAI.lnk\"); " ^
  "$sc.TargetPath = 'wscript.exe'; " ^
  "$sc.Arguments = '\"" + (Get-Location).Path + "\synapse_service.vbs\"'; " ^
  "$sc.WorkingDirectory = (Get-Location).Path; " ^
  "$sc.Description = 'SynapseAI - Servicio en segundo plano'; " ^
  "$sc.Save(); " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$dsc = $ws.CreateShortcut(\"$desktop\SynapseAI — Panel de Control.lnk\"); " ^
  "$dsc.TargetPath = 'http://localhost:3000'; " ^
  "$dsc.IconLocation = (Get-Location).Path + '\extension\icons\icon128.png,0'; " ^
  "$dsc.Description = 'Abrir el panel de SynapseAI en el navegador'; " ^
  "$dsc.Save();"

echo [OK] Inicio automático configurado en Windows.
echo [OK] Acceso directo creado en tu Escritorio: "SynapseAI — Panel de Control".

:: 4. Iniciar servicio en segundo plano y abrir navegador
echo [4/4] Poniendo en marcha el servicio...
wscript.exe "%~dp0synapse_service.vbs"

timeout /t 2 /nobreak >nul

echo.
echo ==============================================================================
echo                      INSTALACIÓN COMPLETADA CON ÉXITO
echo ==============================================================================
echo  - Estado:               EJECUTÁNDOSE EN SEGUNDO PLANO (Sin consola negra)
echo  - Panel de control:     http://localhost:3000
echo  - Inicio automático:    ACTIVADO (Arrancará solo al encender el PC)
echo  - Acceso directo:       Disponible en tu Escritorio
echo ==============================================================================
echo.
echo Abriendo el panel de control en tu navegador...
start http://localhost:3000

echo Puedes cerrar esta ventana. SynapseAI continuará protegiendo tus consultas.
pause >nul
