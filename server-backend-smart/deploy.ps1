# ============================================================================
#  Deploy server-backend-smart len VPS production.
#
#  Cach dung: sau khi push code len nhanh main, chay:
#      .\deploy.ps1
#  tu thu muc server-backend-smart (hoac goi full path tu bat ky dau).
#
#  Script se SSH vao VPS (dung key ~/.ssh/id_rsa, khong can nhap mat khau),
#  pull code moi nhat tu GitHub, roi rebuild + restart docker compose.
#  Cung logic voi .github/workflows/deploy-backend.yml (CI tu dong khi push),
#  file nay la ban chay tay tu may Windows, khong can cho GitHub Actions.
# ============================================================================

$ErrorActionPreference = "Stop"

$VpsUser    = "root"
$VpsHost    = "76.13.16.235"
$DeployDir  = "/opt/smartface"
$RepoUrl    = "https://github.com/asctechsoft/smart-face.git"
$HealthUrl  = "http://$VpsHost:3000/health"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "LOI: $msg" -ForegroundColor Red }

# 1. Canh bao neu con thay doi chua push (deploy se lay code tu GitHub, khong phai tu may local)
Write-Step "Kiem tra git local..."
$branch = git rev-parse --abbrev-ref HEAD 2>$null
if ($branch -ne "main") {
    Write-Host "Dang o nhanh '$branch', khong phai 'main'. VPS luon deploy nhanh main." -ForegroundColor Yellow
}
$dirty = git status --porcelain
if ($dirty) {
    Write-Host "Con thay doi chua commit/push:" -ForegroundColor Yellow
    git status --short
    $confirm = Read-Host "Van tiep tuc deploy code tren GitHub (bo qua thay doi local)? (y/N)"
    if ($confirm -ne "y") { Write-Err "Da huy."; exit 1 }
}
$ahead = git log origin/main..main --oneline 2>$null
if ($ahead) {
    Write-Host "Co commit local chua push len origin/main:" -ForegroundColor Yellow
    Write-Host $ahead
    $confirm = Read-Host "Van tiep tuc deploy (VPS se KHONG thay cac commit nay)? (y/N)"
    if ($confirm -ne "y") { Write-Err "Da huy."; exit 1 }
}

# 2. Remote deploy script chay tren VPS
$remoteScript = @"
set -euo pipefail

DEPLOY_DIR="$DeployDir"
REPO_URL="$RepoUrl"

if [ ! -d "`$DEPLOY_DIR/.git" ]; then
  echo "==> Clone repo lan dau vao `$DEPLOY_DIR"
  git clone "`$REPO_URL" "`$DEPLOY_DIR"
fi

cd "`$DEPLOY_DIR"
git fetch origin main
git reset --hard origin/main

cd "`$DEPLOY_DIR/server-backend-smart"

if [ ! -f .env ]; then
  echo "THIEU server-backend-smart/.env tren VPS." >&2
  echo "Tao file .env (dua theo .env.example) tai `$DEPLOY_DIR/server-backend-smart/.env truoc khi deploy." >&2
  exit 1
fi

echo "==> docker compose build + up"
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f
docker compose -f docker-compose.prod.yml ps
"@

Write-Step "Ket noi va deploy len $VpsUser@$VpsHost ..."
$remoteScript | ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$VpsUser@$VpsHost" "bash -s"
$sshExit = $LASTEXITCODE

if ($sshExit -ne 0) {
    Write-Err "Deploy that bai (exit code $sshExit)"
    exit $sshExit
}

# 3. Health check
Write-Step "Kiem tra health endpoint: $HealthUrl"
try {
    $res = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 15 -UseBasicParsing
    Write-Ok "Health check tra ve $($res.StatusCode)"
    Write-Host $res.Content
} catch {
    Write-Err "Khong goi duoc health endpoint: $_"
    exit 1
}

Write-Ok "Deploy xong!"
