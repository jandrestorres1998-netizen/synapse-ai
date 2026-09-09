# SynapseAI Control Plane Launcher (PowerShell Edition)
$Host.UI.RawUI.WindowTitle = "SynapseAI Control Plane Launcher"
Set-Location $PSScriptRoot

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "                     SYNAPSE AI - THE LOCAL-FIRST AI SHIELD" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Verificando entorno de ejecucion..." -ForegroundColor Yellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js no esta instalado o no se encuentra en el PATH." -ForegroundColor Red
    Write-Host "Descarga e instala Node.js desde: https://nodejs.org/" -ForegroundColor White
    Read-Host "Presiona Enter para salir..."
    exit 1
}
Write-Host "[OK] Node.js detectado correctamente." -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Verificando dependencias locales..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "Instalando dependencias de produccion..." -ForegroundColor White
    npm.cmd install --omit=dev
}
Write-Host "[OK] Dependencias listas." -ForegroundColor Green
Write-Host ""

Write-Host "[3/3] Iniciando Gateway Local en http://localhost:3000 ..." -ForegroundColor Yellow
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host " - Dashboard Web:        http://localhost:3000" -ForegroundColor White
Write-Host " - OpenAI Endpoint:      http://localhost:3000/v1/chat/completions" -ForegroundColor White
Write-Host " - Proteccion DLP:       ACTIVA (RAM-Only)" -ForegroundColor White
Write-Host " - Boveda AES-256:       ACTIVA (Hardware-Bound)" -ForegroundColor White
Write-Host "==============================================================================" -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://localhost:3000"
node server/server.js
