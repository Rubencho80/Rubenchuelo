@echo off
setlocal
chcp 65001 >nul
title Crear Rubenchuelo.exe y el instalador
cd /d "%~dp0.."
set "NODO=runtime\node.exe"
if not exist "%NODO%" set "NODO=node"
"%NODO%" herramientas\construir.js
pause