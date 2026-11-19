# Windows PowerShell: run each module's unit tests. Live services are not required.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Check($Name) {
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
    Write-Host "[OK] $Name" -ForegroundColor Green
}

Write-Host "1/5: Python AI + RabbitMQ worker + downloader (Docker)"
docker build -f ai_service/Dockerfile.test -t birdlab-ai-tests .
Check 'Build Python tests image'
docker run --rm birdlab-ai-tests
Check 'Python tests'

Write-Host "2/5: ASP.NET Core + SQL/API pure logic (Docker)"
docker build -f server.tests/Dockerfile.test -t birdlab-api-tests .
Check 'Build .NET tests image'
docker run --rm birdlab-api-tests
Check '.NET tests'

Write-Host "3/5: Solidity + blockchain gateway (Node.js)"
Push-Location (Join-Path $PSScriptRoot 'chain')
try {
    npm install --no-audit --no-fund
    Check 'Install chain packages'
    npm test
    Check 'Solidity and chain gateway tests'
} finally { Pop-Location }

Write-Host "4/5: React web UI + MetaMask (Node.js)"
Push-Location (Join-Path $PSScriptRoot 'web')
try {
    npm install --no-audit --no-fund
    Check 'Install web packages'
    npm test
    Check 'Web unit tests'
} finally { Pop-Location }

Write-Host "5/5: Expo Go API and photo logic (Node.js)"
Push-Location (Join-Path $PSScriptRoot 'mobile')
try {
    npm install --no-audit --no-fund
    Check 'Install mobile packages'
    npm test
    Check 'Mobile unit tests'
} finally { Pop-Location }

Write-Host 'All modules passed.' -ForegroundColor Green
