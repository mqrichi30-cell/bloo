@echo off
REM === bloo — ver en el celular (link FIJO: https://bloocr.loca.lt) ===
cd /d C:\bloo

echo Iniciando servidor bloo en el puerto 3010...
start "bloo dev" cmd /k "npm run dev"

echo Esperando a que arranque el servidor...
timeout /t 12 /nobreak >nul

echo Abriendo tunel con link fijo (https://bloocr.loca.lt)...
start "bloo tunnel" cmd /k "npx --yes localtunnel --port 3010 --subdomain bloocr"

echo.
echo ==============================================================
echo   Link FIJO (siempre el mismo):  https://bloocr.loca.lt
echo   Abrilo en el celular. Login: admin / vendedor
echo.
echo   Nota: la primera vez loca.lt muestra una pagina de aviso.
echo   Toca "Click to Continue" (si pide clave, es la IP publica
echo   que la misma pagina muestra). Es una sola vez.
echo.
echo   Deja estas dos ventanas ABIERTAS mientras uses la app.
echo ==============================================================
echo.
pause
