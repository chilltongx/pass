@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall add rule name="Pass Transfer 6789" dir=in action=allow protocol=TCP localport=6789 profile=any
echo.
echo Pass Transfer 6789 firewall rule is ready.
pause
