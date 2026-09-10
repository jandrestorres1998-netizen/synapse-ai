@echo off
title SynapseAI — Instalador de la Extensión para el Navegador
color 0B
chcp 65001 >nul

cd /d "%~dp0"

echo ==============================================================================
echo           SYNAPSE AI — INSTALACIÓN DE LA EXTENSIÓN DE NAVEGADOR
echo ==============================================================================
echo.
echo Este asistente copiará la extensión a una carpeta segura de tu ordenador
echo para que puedas usarla en Google Chrome, Microsoft Edge, Brave u Opera.
echo.

set "DEST=%LOCALAPPDATA%\SynapseAI\Extension"

if not exist "%DEST%" mkdir "%DEST%"

echo [1/2] Copiando archivos de la extensión a %DEST%...
xcopy /s /y /q "%~dp0*.*" "%DEST%\" >nul
echo [OK] Archivos preparados en tu equipo.
echo.

echo [2/2] Abriendo la página de extensiones en tu navegador...
echo.
echo Pasos a seguir en la ventana que se acaba de abrir:
echo  1. Activa el "Modo de desarrollador" (arriba a la derecha).
echo  2. Haz clic en "Cargar descomprimida" (o "Cargar extensión sin empaquetar").
echo  3. Pega esta ruta de carpeta y pulsa Seleccionar:
echo.
echo     %DEST%
echo.

:: Copiar la ruta automáticamente al portapapeles de Windows para mayor comodidad
echo %DEST%| clip
echo (La ruta ya se ha copiado automáticamente a tu portapapeles. Solo tienes que pulsar Ctrl + V).
echo.

:: Abrir Chrome o Edge
start chrome "chrome://extensions" 2>nul || start msedge "edge://extensions" 2>nul

echo Pulsa cualquier tecla para finalizar.
pause >nul
