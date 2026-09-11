@echo off
title SynapseAI — Detener servicio
color 0C
chcp 65001 >nul

echo ==============================================================================
echo                 SYNAPSE AI — DETENER SERVICIO EN SEGUNDO PLANO
echo ==============================================================================
echo.

powershell -NoProfile -Command ^
  "$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*node*server/server.js*' }; " ^
  "if ($procs) { " ^
  "  $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('[OK] Proceso ' + $_.ProcessId + ' detenido.') -ForegroundColor Green }; " ^
  "} else { " ^
  "  Write-Host '[INFO] No se encontró ninguna instancia activa de SynapseAI en ejecución.' -ForegroundColor Yellow; " ^
  "}"

echo.
echo SynapseAI ha sido detenido.
pause
