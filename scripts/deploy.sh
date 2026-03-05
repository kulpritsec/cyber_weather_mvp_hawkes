#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DEPLOY SCRIPT — Called by CI/CD or manually
# Usage: bash scripts/deploy.sh [backend|frontend|all]
# ═══════════════════════════════════════════════════════════════
set -e
cd ~/cyber-weather/app

TARGET=${1:-all}

echo "Deploying: $TARGET"

# Pull latest
git pull origin main

case $TARGET in
  backend)
    docker compose build --no-cache backend
    docker compose up -d backend
    ;;
  frontend)
    docker compose build --no-cache frontend
    docker compose up -d frontend
    ;;
  all)
    docker compose build --no-cache backend frontend
    docker compose up -d backend frontend
    ;;
esac

# Health check
sleep 8
curl -sf http://localhost:8000/healthz && echo "Backend: OK" || echo "Backend: FAIL"
curl -sf http://localhost:3000/ > /dev/null && echo "Frontend: OK" || echo "Frontend: FAIL"

echo "Deploy complete: $(date)"
