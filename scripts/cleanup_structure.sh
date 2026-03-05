#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# CLEANUP: cyber-weather app structure
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   chmod +x cleanup_structure.sh
#   ./cleanup_structure.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

PROD="$HOME/cyber-weather/app"
STALE="$HOME/app"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  CYBER-WEATHER STRUCTURE CLEANUP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── 1. VERIFY PRODUCTION IS WHAT DOCKER RUNS ────────────────────────────

echo "▸ STEP 1: Confirm production directory"

if docker compose -f "$PROD/docker-compose.yml" ps --quiet 2>/dev/null | head -1 | grep -q .; then
    ok "Docker containers running from $PROD"
else
    warn "Could not confirm running containers — proceeding anyway"
fi
echo ""

# ─── 2. REMOVE STALE ~/app/ CLONE ────────────────────────────────────────

echo "▸ STEP 2: Remove stale ~/app/ clone"

if [ -d "$STALE" ]; then
    echo ""
    echo "  ~/app/ is a stale duplicate of ~/cyber-weather/app/"
    echo "  It has no .env frontend config, no public assets — nothing"
    echo "  is running from it. Docker Compose runs from ~/cyber-weather/app/."
    echo ""

    # Quick diff to confirm they're the same codebase
    STALE_FILES=$(find "$STALE" -maxdepth 1 -type f | wc -l)
    PROD_FILES=$(find "$PROD" -maxdepth 1 -type f | wc -l)
    info "~/app/ has $STALE_FILES root files, ~/cyber-weather/app/ has $PROD_FILES"

    read -p "  Delete ~/app/ entirely? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$STALE"
        ok "Removed ~/app/"
    else
        warn "Skipped — ~/app/ still exists"
    fi
else
    ok "~/app/ already gone"
fi
echo ""

# ─── 3. REMOVE DUPLICATE countries-110m.json FROM APP ROOT ───────────────

echo "▸ STEP 3: Remove duplicate countries-110m.json"

ROOT_GEO="$PROD/countries-110m.json"
FRONTEND_GEO="$PROD/frontend/public/countries-110m.json"

if [ -f "$ROOT_GEO" ]; then
    if [ -f "$FRONTEND_GEO" ]; then
        # Verify they're the same file
        if cmp -s "$ROOT_GEO" "$FRONTEND_GEO"; then
            info "Identical copy exists at frontend/public/ — removing root copy"
            rm "$ROOT_GEO"
            ok "Removed app/countries-110m.json (duplicate)"
        else
            warn "Files differ! Keeping both — investigate manually"
            diff <(wc -c "$ROOT_GEO") <(wc -c "$FRONTEND_GEO") || true
        fi
    else
        info "Only copy is at app root — moving to frontend/public/"
        mv "$ROOT_GEO" "$FRONTEND_GEO"
        ok "Moved to frontend/public/countries-110m.json"
    fi
else
    ok "Already clean — no root-level countries-110m.json"
fi
echo ""

# ─── 4. MOVE fix_ingest_bugs.py TO backend/scripts/ ─────────────────────

echo "▸ STEP 4: Relocate fix_ingest_bugs.py"

FIX_SCRIPT="$PROD/fix_ingest_bugs.py"
SCRIPTS_DIR="$PROD/backend/scripts"

if [ -f "$FIX_SCRIPT" ]; then
    mkdir -p "$SCRIPTS_DIR"
    mv "$FIX_SCRIPT" "$SCRIPTS_DIR/fix_ingest_bugs.py"
    ok "Moved to backend/scripts/fix_ingest_bugs.py"
else
    ok "Already clean — no root-level fix_ingest_bugs.py"
fi
echo ""

# ─── 5. ORGANIZE DOCS ───────────────────────────────────────────────────

echo "▸ STEP 5: Organize documentation"

DOCS_DIR="$PROD/docs"

# README.md stays at root (standard), but move the others to docs/
if [ -f "$PROD/MVP_STATUS.md" ] || [ -f "$PROD/ENHANCEMENTS_SUMMARY.md" ]; then
    mkdir -p "$DOCS_DIR"

    [ -f "$PROD/MVP_STATUS.md" ] && mv "$PROD/MVP_STATUS.md" "$DOCS_DIR/" && ok "Moved MVP_STATUS.md → docs/"
    [ -f "$PROD/ENHANCEMENTS_SUMMARY.md" ] && mv "$PROD/ENHANCEMENTS_SUMMARY.md" "$DOCS_DIR/" && ok "Moved ENHANCEMENTS_SUMMARY.md → docs/"
else
    ok "Docs already organized"
fi
echo ""

# ─── 6. UPDATE .gitignore ────────────────────────────────────────────────

echo "▸ STEP 6: Verify .gitignore"

GITIGNORE="$PROD/.gitignore"
ADDITIONS=()

# Check for common entries that should be present
for PATTERN in "*.pyc" "__pycache__" "node_modules" ".env" "*.db" "backups/"; do
    if [ -f "$GITIGNORE" ] && grep -q "$PATTERN" "$GITIGNORE"; then
        : # already there
    else
        ADDITIONS+=("$PATTERN")
    fi
done

if [ ${#ADDITIONS[@]} -gt 0 ]; then
    echo "" >> "$GITIGNORE"
    echo "# Added by cleanup script" >> "$GITIGNORE"
    for PATTERN in "${ADDITIONS[@]}"; do
        echo "$PATTERN" >> "$GITIGNORE"
        info "Added $PATTERN to .gitignore"
    done
    ok "Updated .gitignore"
else
    ok ".gitignore looks good"
fi
echo ""

# ─── 7. FINAL STRUCTURE REPORT ──────────────────────────────────────────

echo "▸ STEP 7: Final structure"
echo ""
echo "  ~/cyber-weather/app/"
echo "  ├── .env                          # Docker env vars (DB, API keys)"
echo "  ├── .gitignore"
echo "  ├── docker-compose.yml            # Orchestration: db, backend, frontend"
echo "  ├── README.md                     # Project root readme"
echo "  ├── docs/"
echo "  │   ├── MVP_STATUS.md"
echo "  │   └── ENHANCEMENTS_SUMMARY.md"
echo "  ├── backend/"
echo "  │   ├── Dockerfile"
echo "  │   ├── requirements.txt"
echo "  │   ├── start.py"
echo "  │   ├── app/                      # FastAPI application"
echo "  │   │   ├── main.py"
echo "  │   │   ├── config.py"
echo "  │   │   ├── db.py"
echo "  │   │   ├── models.py"
echo "  │   │   ├── schemas.py"
echo "  │   │   ├── routers/"
echo "  │   │   ├── services/"
echo "  │   │   ├── ingest/"
echo "  │   │   ├── forecast/"
echo "  │   │   ├── core/"
echo "  │   │   └── utils/"
echo "  │   ├── tests/"
echo "  │   └── scripts/"
echo "  │       └── fix_ingest_bugs.py"
echo "  └── frontend/"
echo "      ├── Dockerfile"
echo "      ├── nginx.conf"
echo "      ├── package.json"
echo "      ├── vite.config.ts"
echo "      ├── tsconfig.json"
echo "      ├── index.html"
echo "      ├── public/"
echo "      │   └── countries-110m.json"
echo "      ├── src/"
echo "      │   ├── App.tsx"
echo "      │   ├── main.tsx"
echo "      │   ├── styles.css"
echo "      │   ├── components/"
echo "      │   ├── lib/"
echo "      │   └── utils/"
echo "      └── docs/"
echo "          └── build-history/"
echo ""

# ─── 8. GIT COMMIT ──────────────────────────────────────────────────────

echo "▸ STEP 8: Commit changes"
echo ""
read -p "  Commit the restructuring to git? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$PROD"
    git add -A
    git status --short
    echo ""
    git commit -m "chore: clean up project structure

- Remove duplicate countries-110m.json from app root (already in frontend/public/)
- Move fix_ingest_bugs.py to backend/scripts/
- Move MVP_STATUS.md and ENHANCEMENTS_SUMMARY.md to docs/
- Update .gitignore"
    ok "Committed"
else
    warn "Skipped git commit — remember to commit later"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ CLEANUP COMPLETE${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  No rebuild needed — this was filesystem only."
echo "  ~/app/ removed, production tree is clean."
echo ""
