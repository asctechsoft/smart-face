# ============================================================================
#  Deploy SmartFace (web + api + worker + ai-server) len VPS production.
#
#  Cach dung: sau khi push code len nhanh main, chay:
#      .\deploy.ps1
#  tu thu muc server-backend-smart (hoac goi full path tu bat ky dau).
#
#  Script se SSH vao VPS (dung SSH key, khong can nhap mat khau), pull code
#  moi nhat tu GitHub, rebuild + restart docker compose, roi cho api bao song.
#  Cung logic voi .github/workflows/deploy-backend.yml (CI tu dong khi push),
#  file nay la ban chay tay tu may Windows, khong can cho GitHub Actions.
#
#  Huong dan day du: docs/23-huong-dan-deploy-cho-nguoi-moi.md
# ============================================================================

$ErrorActionPreference = "Stop"

$VpsUser    = "root"
$VpsHost    = "76.13.16.235"
$DeployDir  = "/opt/smartface"
$RepoUrl    = "https://github.com/asctechsoft/smart-face.git"

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

# 2. Script chay tren VPS. Here-string dau nhay DON: PowerShell khong dung toi
#    cac dau $ cua bash.
$remoteScript = @'
set -euo pipefail

DEPLOY_DIR="__DEPLOY_DIR__"
REPO_URL="__REPO_URL__"

if [ ! -d "$DEPLOY_DIR/.git" ]; then
  echo "==> Clone repo lan dau vao $DEPLOY_DIR"
  git clone "$REPO_URL" "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"
git fetch origin main
git reset --hard origin/main

cd "$DEPLOY_DIR/server-backend-smart"

if [ ! -f .env ]; then
  echo "THIEU server-backend-smart/.env tren VPS." >&2
  echo "Tao bang: bash scripts/init-prod-env.sh <ten-mien> <file-firebase.json> (xem docs/23)." >&2
  exit 1
fi

echo "==> docker compose build + up"
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f

# Cong 3000 chi nghe 127.0.0.1 nen phai kiem tra tu CHINH VPS.
echo "==> Cho api san sang (migration + dong bo du lieu nen)..."
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null 2>&1; then
    echo "api OK sau $((i * 3)) giay"
    docker compose -f docker-compose.prod.yml ps
    exit 0
  fi
  sleep 3
done

echo "api KHONG san sang sau 120 giay. Log gan nhat:" >&2
docker compose -f docker-compose.prod.yml ps >&2
docker compose -f docker-compose.prod.yml logs --tail=80 api >&2
exit 1
'@
$remoteScript = $remoteScript.Replace('__DEPLOY_DIR__', $DeployDir).Replace('__REPO_URL__', $RepoUrl)

# File nay luu CRLF tren Windows. Bash tren VPS doc `\r` thanh mot phan cua gia
# tri (`/opt/smartface\r`) va moi lenh cd deu hong — nen chuan hoa ve LF, roi
# gui dang base64 de PowerShell khong chen them CRLF khi pipe vao ssh.
$remoteScript = $remoteScript -replace "`r`n", "`n"
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))

Write-Step "Ket noi va deploy len $VpsUser@$VpsHost ..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$VpsUser@$VpsHost" "echo $encoded | base64 -d | bash"
$sshExit = $LASTEXITCODE

if ($sshExit -ne 0) {
    Write-Err "Deploy that bai (exit code $sshExit)"
    exit $sshExit
}

Write-Ok "Deploy xong!"
