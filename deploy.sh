#!/usr/bin/env bash
# ============================================================
# Deploy script: ship local code to the SaaS EC2 host and
# rebuild the api/frontend containers without touching:
#   - .env on the server (secrets stay put)
#   - the postgres volume (data stays put)
# ============================================================
set -euo pipefail

PEM="${PEM:-D:/server/2server.pem}"
HOST="${HOST:-ubuntu@ec2-16-171-169-148.eu-north-1.compute.amazonaws.com}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/gym-saas}"
SERVICE="${SERVICE:-api frontend}"  # space-separated; pass SERVICE=api to deploy api only

cd "$(dirname "$0")"

TARBALL=$(mktemp -t gym-saas.XXXXXX.tar.gz)
trap 'rm -f "$TARBALL"' EXIT

echo "[deploy] packaging code (excluding .env, node_modules, .next, .git)..."
tar --exclude='./.env' \
    --exclude='./.env.local' \
    --exclude='./node_modules' \
    --exclude='./.git' \
    --exclude='./.next' \
    --exclude='./backend/node_modules' \
    --exclude='./frontend/node_modules' \
    --exclude='./frontend/.next' \
    --exclude='*.tar.gz' \
    --exclude='*.log' \
    -czf "$TARBALL" .

SIZE=$(du -h "$TARBALL" | cut -f1)
echo "[deploy] tarball: $SIZE"

echo "[deploy] uploading..."
scp -i "$PEM" -o StrictHostKeyChecking=no "$TARBALL" "$HOST:/tmp/gym-saas-deploy.tar.gz"

echo "[deploy] extracting + rebuilding services: $SERVICE"
ssh -i "$PEM" -o StrictHostKeyChecking=no "$HOST" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
# Untar OVER existing files but keep .env intact (it's excluded from the archive)
tar -xzf /tmp/gym-saas-deploy.tar.gz
rm /tmp/gym-saas-deploy.tar.gz
echo "[deploy] rebuilding: $SERVICE"
sudo docker compose up -d --build $SERVICE
sleep 4
sudo docker compose ps
EOF

echo "[deploy] done."
