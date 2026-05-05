#!/usr/bin/env bash
# ============================================================
# Run this on the SaaS server AFTER gym.bizdaoson.uz DNS is live.
# Issues a Let's Encrypt cert via certbot --nginx and switches the
# nginx site to redirect HTTP → HTTPS.
# ============================================================
set -euo pipefail

DOMAIN=gym.bizdaoson.uz
EMAIL="${EMAIL:-aotkirovme@gmail.com}"

echo "[ssl] verifying DNS resolves to this host..."
host_ip=$(curl -sf https://api.ipify.org)
domain_ip=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
echo "  this host: $host_ip"
echo "  $DOMAIN  : ${domain_ip:-NXDOMAIN}"
if [ -z "$domain_ip" ]; then
  echo "[ssl] DNS not yet propagated. Add an A record for '$DOMAIN' → $host_ip in Cloudflare and try again."
  exit 1
fi

# If DNS is proxied through Cloudflare (orange cloud), domain_ip will be a CF IP.
# That's fine — Cloudflare → our nginx works either way. Skip the strict equality check.

echo "[ssl] requesting Let's Encrypt cert via nginx plugin..."
sudo certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive --agree-tos -m "$EMAIL" \
  --redirect

echo "[ssl] testing renewal hook..."
sudo certbot renew --dry-run

echo "[ssl] reloading nginx..."
sudo nginx -t
sudo systemctl reload nginx

echo "[ssl] done — try: curl -s https://$DOMAIN/api/health"
