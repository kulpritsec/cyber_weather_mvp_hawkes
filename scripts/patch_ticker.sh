#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PATCH: Add Live Threat Ticker to bottom of globe
# ═══════════════════════════════════════════════════════════════════════════════
#
# Adds a scrolling CTI event feed at the bottom of the globe showing:
#   - Timestamp, vector indicator, action, source→target, feed badge
#   - Tries SSE /v1/events/stream first, falls back to simulated events
#   - "LIVE THREAT FEED" label with pulsing connection indicator
#
# Usage:
#   cd ~/cyber-weather/app
#   chmod +x patch_ticker.sh
#   ./patch_ticker.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
GLOBE="$APP_DIR/frontend/src/components/CyberWeatherGlobe.tsx"
PANELS_DIR="$APP_DIR/frontend/src/components/Panels"
TICKER_SRC="$APP_DIR/LiveThreatTicker.jsx"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  LIVE THREAT TICKER — DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

[ -f "$GLOBE" ] || fail "CyberWeatherGlobe.tsx not found"
[ -f "$TICKER_SRC" ] || fail "LiveThreatTicker.jsx not found in $APP_DIR"

# ─── BACKUP ───────────────────────────────────────────────────────────────
BACKUP_DIR="$APP_DIR/backups/$(date +%Y%m%d_%H%M%S)_ticker"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
ok "Backed up to $BACKUP_DIR"
echo ""

# ─── 1. PLACE COMPONENT ──────────────────────────────────────────────────
echo "▸ STEP 1: Place component"
cp "$TICKER_SRC" "$PANELS_DIR/LiveThreatTicker.jsx"
ok "Copied to $PANELS_DIR/LiveThreatTicker.jsx"

# Update Panels/index.ts
INDEX="$PANELS_DIR/index.ts"
if [ -f "$INDEX" ] && ! grep -q "LiveThreatTicker" "$INDEX"; then
    echo "" >> "$INDEX"
    echo "// Live Threat Feed Ticker" >> "$INDEX"
    echo "export { default as LiveThreatTicker } from './LiveThreatTicker';" >> "$INDEX"
    ok "Added export to Panels/index.ts"
elif grep -q "LiveThreatTicker" "$INDEX" 2>/dev/null; then
    ok "Already exported in index.ts"
fi
echo ""

# ─── 2. ADD IMPORT ───────────────────────────────────────────────────────
echo "▸ STEP 2: Add import"

if grep -q "LiveThreatTicker" "$GLOBE"; then
    ok "Already imported (skipping)"
else
    # Add to barrel import
    if grep -q "NetworkFlowMathematics" "$GLOBE"; then
        sed -i "s|NetworkFlowMathematics }|NetworkFlowMathematics, LiveThreatTicker }|" "$GLOBE"
        ok "Added to barrel import"
    elif grep -q "from './Panels'" "$GLOBE"; then
        sed -i "s|} from './Panels'|, LiveThreatTicker } from './Panels'|" "$GLOBE"
        ok "Added to barrel import"
    else
        # Standalone import after last panel import
        LAST_IMPORT=$(grep -n "import.*from.*Panels" "$GLOBE" | tail -1 | cut -d: -f1)
        if [ -n "$LAST_IMPORT" ]; then
            sed -i "${LAST_IMPORT}a\\import LiveThreatTicker from './Panels/LiveThreatTicker';" "$GLOBE"
            ok "Added standalone import"
        else
            sed -i "1a\\import LiveThreatTicker from './Panels/LiveThreatTicker';" "$GLOBE"
            ok "Added import at top"
        fi
    fi
fi
echo ""

# ─── 3. ADD TICKER RENDER ────────────────────────────────────────────────
echo "▸ STEP 3: Add ticker render"

if grep -q "<LiveThreatTicker" "$GLOBE"; then
    ok "Already rendered (skipping)"
else
    # Insert before the {/* Keyframes */} <style> block — this places it
    # at the very bottom of the globe, after all panels
    STYLE_LINE=$(grep -n "{/\* Keyframes \*/}" "$GLOBE" | head -1 | cut -d: -f1)

    if [ -n "$STYLE_LINE" ]; then
        sed -i "${STYLE_LINE}i\\
\\
      {/* ─── LIVE THREAT FEED TICKER ─── */}\\
      <LiveThreatTicker />" "$GLOBE"
        ok "Inserted ticker before Keyframes block"
    else
        # Fallback: insert before closing </div> + <style>
        CLOSE_STYLE=$(grep -n "<style>" "$GLOBE" | tail -1 | cut -d: -f1)
        if [ -n "$CLOSE_STYLE" ]; then
            sed -i "${CLOSE_STYLE}i\\
\\
      {/* ─── LIVE THREAT FEED TICKER ─── */}\\
      <LiveThreatTicker />" "$GLOBE"
            ok "Inserted ticker before <style> block"
        else
            fail "Could not find insertion point for ticker"
        fi
    fi
fi
echo ""

# ─── VALIDATE ─────────────────────────────────────────────────────────────
echo "▸ STEP 4: Validate"

ERRORS=0
grep -q "LiveThreatTicker" "$GLOBE"                           || { echo -e "  ${RED}✗${NC} Missing import"; ERRORS=$((ERRORS+1)); }
grep -q "<LiveThreatTicker" "$GLOBE"                          || { echo -e "  ${RED}✗${NC} Missing render"; ERRORS=$((ERRORS+1)); }
[ -f "$PANELS_DIR/LiveThreatTicker.jsx" ]                     || { echo -e "  ${RED}✗${NC} Component file missing"; ERRORS=$((ERRORS+1)); }

if [ "$ERRORS" -gt 0 ]; then
    fail "$ERRORS validation errors"
fi
ok "All patches validated"

# Syntax check
OPEN=$(grep -o '{' "$GLOBE" | wc -l)
CLOSE=$(grep -o '}' "$GLOBE" | wc -l)
DIFF=$((OPEN - CLOSE))
[ "$DIFF" -eq 0 ] && ok "Brace count balanced" || info "Brace diff=$DIFF (may be fine with template literals)"

echo ""

# ─── BUILD ────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  Ready to build"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  New file:  frontend/src/components/Panels/LiveThreatTicker.jsx"
echo "  Modified:  frontend/src/components/CyberWeatherGlobe.tsx"
echo ""
echo "  The ticker will:"
echo "    • Try SSE connection to /v1/events/stream"
echo "    • Fall back to simulated CTI events if SSE unavailable"
echo "    • Show LIVE THREAT FEED label with connection indicator"
echo "    • Scroll: timestamp │ vector │ action │ source → target │ feed"
echo ""

read -p "  Build and deploy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$APP_DIR"
    info "Building frontend..."
    docker compose build --no-cache frontend
    info "Deploying..."
    docker compose up -d frontend
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  Live threat ticker now scrolling at bottom of globe"
    echo "  Shows SIMULATED until SSE /v1/events/stream is live"
    echo ""
    echo "  Rollback: cp $BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
    echo "            frontend/src/components/CyberWeatherGlobe.tsx"
    echo "═══════════════════════════════════════════════════════════"
else
    echo "  Skipped. Build manually with:"
    echo "    docker compose build --no-cache frontend && docker compose up -d frontend"
fi
