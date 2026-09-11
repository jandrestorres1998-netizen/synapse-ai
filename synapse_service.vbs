' SynapseAI — Lanzador Silencioso para Windows
' Ejecuta el servidor Node.js en segundo plano sin ventana de consola visible.
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Directorio donde reside este script
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptDir

' Comando de ejecución en segundo plano (0 = ventana oculta, false = no bloquear)
Command = "cmd.exe /c node server/server.js"
WshShell.Run Command, 0, False
