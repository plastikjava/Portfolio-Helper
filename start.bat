@echo off
title Kita-Portfolio-Studio
echo ===================================================
echo   Starte Kita-Portfolio-Studio Server...
echo ===================================================
echo.

:: Browser oeffnen
start "" "http://localhost:3000"

:: Server starten (haelt das Konsolenfenster fuer Logs offen)
node server.js

pause
