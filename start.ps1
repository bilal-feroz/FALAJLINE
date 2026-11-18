# Starts the FALAJLINE backend and frontend in two PowerShell windows.
# Needs Python 3.11+ and Node 20+ on the PATH. Meteomatics credentials go in backend\.env (see backend\.env.example).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path "$root\backend\.venv")) {
    Write-Host "Creating the Python environment..."
    python -m venv "$root\backend\.venv"
    & "$root\backend\.venv\Scripts\python.exe" -m pip install -q -r "$root\backend\requirements-dev.txt"
}
if (-not (Test-Path "$root\frontend\node_modules")) {
    Write-Host "Installing frontend packages..."
    Push-Location "$root\frontend"; npm install; Pop-Location
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"
Write-Host "Backend: http://localhost:8000/docs   Frontend: http://localhost:3000"
