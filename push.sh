#!/bin/bash

REPO="dugongyete-ui/gamedzeckai"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN belum diset."
  echo "Simpan sebagai Replit Secret bernama GITHUB_TOKEN."
  exit 1
fi

REMOTE_URL="https://x-token-auth:${GITHUB_TOKEN}@github.com/${REPO}.git"

# Bersihkan stale lock files
echo "Membersihkan git lock files..."
find .git -name "*.lock" -delete 2>/dev/null || true

echo "Pull dulu dari GitHub (rebase)..."
git pull --rebase "$REMOTE_URL" main 2>&1
PULL_CODE=$?

if [ $PULL_CODE -ne 0 ]; then
  echo ""
  echo "Pull gagal. Kemungkinan ada konflik merge."
  echo "Selesaikan konflik dulu, lalu jalankan push.sh lagi."
  exit 1
fi

echo "Pushing ke GitHub..."
git push "$REMOTE_URL" main 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "Push berhasil!"
else
  echo ""
  echo "Push gagal. Kemungkinan penyebab:"
  echo "  1. Token expired — buat token baru di https://github.com/settings/tokens"
  echo "  2. GitHub Secret Scanning memblokir — ikuti URL unblock dari GitHub"
  echo "  3. Konflik — selesaikan merge conflict dulu"
  exit 1
fi