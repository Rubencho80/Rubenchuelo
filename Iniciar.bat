@echo off
setlocal
chcp 65001 >nul
title Rubenchuelo
cd /d "%~dp0"

set "NODO=%~dp0runtime\node.exe"
if not exist "%NODO%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   No encuentro Node.js: falta el archivo runtime\node.exe
    echo   Vuelve a copiar la carpeta entera de Rubenchuelo o instala Node.js desde https://nodejs.org
    echo.
    pause
    exit /b 1
  )
  set "NODO=node"
)

"%NODO%" "%~dp0app\servidor.js" %*
if errorlevel 1 (
  echo.
  echo   Rubenchuelo se ha cerrado con un error. Lee el mensaje de arriba.
  echo.
  pause
)
