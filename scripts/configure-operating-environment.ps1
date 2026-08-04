$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectName = "iljin-ai-works"
$bucketName = "iljin-ai-works-originals"
$envFile = Join-Path $PSScriptRoot "..\.env.local"
$requiredSecrets = @(
  "BRAVE_SEARCH_API_KEY"
)

function Read-DotEnv {
  param([string]$Path)
  $result = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $result
  }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch "^[A-Za-z_][A-Za-z0-9_]*=") {
      continue
    }
    $parts = $line -split "=", 2
    $result[$parts[0]] = $parts[1].Trim()
  }
  return $result
}

function Invoke-Wrangler {
  param([string[]]$Arguments)
  & npx.cmd wrangler @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler command failed: $($Arguments -join ' ')"
  }
}

$settings = Read-DotEnv -Path $envFile
$missing = @($requiredSecrets | Where-Object {
  -not $settings.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($settings[$_])
})

Write-Host "[1/4] Cloudflare R2 확인"
$bucketList = (& npx.cmd wrangler r2 bucket list 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "R2 계정 상태를 확인하지 못했습니다."
}
if ($bucketList -notmatch [regex]::Escape($bucketName)) {
  Invoke-Wrangler -Arguments @("r2", "bucket", "create", $bucketName)
}
Write-Host "R2 버킷 준비 완료"

Write-Host "[2/4] 운영 Secret 확인"
foreach ($key in $requiredSecrets) {
  $available = $settings.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($settings[$key])
  Write-Host ("{0}: {1}" -f $key, $(if ($available) { "준비됨" } else { "필요" }))
}

if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host "아직 입력되지 않은 Secret: $($missing -join ', ')"
  Write-Host ".env.local에 값을 저장한 뒤 이 명령을 다시 실행하세요."
  exit 2
}

Write-Host "[3/4] Cloudflare Pages Secret 등록"
foreach ($key in $requiredSecrets) {
  $settings[$key] | & npx.cmd wrangler pages secret put $key --project-name $projectName
  if ($LASTEXITCODE -ne 0) {
    throw "$key Secret 등록에 실패했습니다."
  }
}

Write-Host "[4/4] 운영 배포 및 상태 확인"
& npm.cmd run deploy:pages
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare Pages 배포에 실패했습니다."
}

$health = Invoke-RestMethod -Uri "https://$projectName.pages.dev/api/health" -TimeoutSec 30
Write-Host "운영 상태: $($health.status)"
Write-Host "R2: $($health.rag.r2Configured)"
Write-Host "Embedding: $($health.rag.embeddingConfigured)"
Write-Host "Reranker: $($health.rag.rerankConfigured)"
Write-Host "Cloudflare Kimi K2.6: $($health.llmRouting.fallbackConfigured)"
Write-Host "Brave Search: $($health.internetSearch.configured)"
