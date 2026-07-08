# Script para iniciar el servidor con Socket.io
Set-Location $PSScriptRoot

# Cargar variables de .env.local
Get-Content .env.local | ForEach-Object {
    if ($_ -match "^([^#][^=]+)=(.*)$") {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

Write-Host "Variables de entorno cargadas desde .env.local"
Write-Host "Iniciando servidor con Socket.io..."

# Ejecutar tsx
npx tsx server.ts
