@echo off
chcp 65001 >nul
title Motora Teste - Robo
cd /d %~dp0

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Vou instalar agora...
  winget install -e --id OpenJS.NodeJS.LTS
  echo.
  echo Pronto. Feche e abra de novo este arquivo INICIAR.bat.
  pause
  exit /b
)

where git >nul 2>nul
if errorlevel 1 (
  echo O Git nao esta instalado ^(o robo precisa dele para baixar seus arquivos^). Vou instalar agora...
  winget install -e --id Git.Git
  echo.
  echo Pronto. Feche e abra de novo este arquivo INICIAR.bat.
  pause
  exit /b
)

if not exist node_modules\@whiskeysockets\baileys (
  echo Baixando os arquivos do robo. Isso so acontece na primeira vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo Não consegui instalar. Verifique a internet e abra de novo.
    pause
    exit /b
  )
)

node index.js
pause
