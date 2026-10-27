@echo off
chcp 65001 >nul
cd /d %~dp0
set "ALVO=%~dp0INICIAR.bat"
set "ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Campos-Robo.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ATALHO); $s.TargetPath=$env:ALVO; $s.WorkingDirectory=(Split-Path $env:ALVO); $s.Save()"
if errorlevel 1 (
  echo Nao consegui criar o atalho.
) else (
  echo Pronto! O robo vai abrir sozinho quando o Windows ligar.
  echo Para desfazer, apague o atalho Campos-Robo na pasta Inicializar.
)
pause
