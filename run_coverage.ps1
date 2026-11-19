# Run on Windows PowerShell from the repository root. No live Docker Compose stack needed.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Assert-Last($Title) {
    if ($LASTEXITCODE -ne 0) { throw "$Title FAILED (exit code $LASTEXITCODE)" }
    Write-Host "[OK] $Title" -ForegroundColor Green
}

New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'coverage') -Force | Out-Null
$coverageDir = (Resolve-Path (Join-Path $PSScriptRoot 'coverage')).Path

Write-Host '[1/4] Python AI + RabbitMQ worker + test-photo downloader' -ForegroundColor Cyan
docker build -f ai_service/Dockerfile.test -t ai-bird-lab-coverage-python .
Assert-Last 'Python test image'
docker run --rm -v "${coverageDir}:/reports" ai-bird-lab-coverage-python
Assert-Last 'Python tests + >=90% branch-aware coverage'

Write-Host '[2/4] Solidity: actual contract execution and gateway coverage' -ForegroundColor Cyan
Push-Location chain
try {
    npm install --no-audit --no-fund
    Assert-Last 'Chain dependencies'
    npm run test:coverage
    Assert-Last 'Blockchain tests + coverage'
} finally { Pop-Location }

Write-Host '[3/4] React + TypeScript dashboard, API and MetaMask' -ForegroundColor Cyan
Push-Location web
try {
    npm install --no-audit --no-fund
    Assert-Last 'React dependencies'
    npm run test:coverage
    Assert-Last 'Web tests + >=90% coverage'
} finally { Pop-Location }

Write-Host '[4/4] Expo Go app: mobile screens and API' -ForegroundColor Cyan
Push-Location mobile
try {
    npm install --no-audit --no-fund
    Assert-Last 'Expo dependencies'
    npm run test:coverage
    Assert-Last 'Expo tests + >=90% coverage'
} finally { Pop-Location }

Write-Host 'All four groups completed and coverage thresholds passed.' -ForegroundColor Green
Write-Host 'Reports: coverage/python-coverage.xml, chain/coverage/, web/coverage/, mobile/coverage/'
