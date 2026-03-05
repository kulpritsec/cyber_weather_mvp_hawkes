#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PATCH: Add CTI Feed Status panel + backend /v1/feeds/status endpoint
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
GLOBE="$APP_DIR/frontend/src/components/CyberWeatherGlobe.tsx"
PANELS_DIR="$APP_DIR/frontend/src/components/Panels"
ROUTER="$APP_DIR/backend/app/routers/unified.py"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  CTI FEED STATUS — DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

[ -f "$GLOBE" ] || fail "CyberWeatherGlobe.tsx not found"
[ -f "$ROUTER" ] || fail "unified.py router not found"

# ─── BACKUP ───────────────────────────────────────────────────────────────
BACKUP_DIR="$APP_DIR/backups/$(date +%Y%m%d_%H%M%S)_feedstatus"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
cp "$ROUTER" "$BACKUP_DIR/unified.py.bak"
ok "Backed up to $BACKUP_DIR"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 1: BACKEND — Add /v1/feeds/status endpoint
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ PART 1: Backend — /v1/feeds/status endpoint"

if grep -q "feeds/status" "$ROUTER"; then
    ok "Endpoint already exists (skipping)"
else
    # Find the last function in unified.py and append after it
    cat >> "$ROUTER" << 'ENDPOINT_EOF'


# ─── FEED STATUS ENDPOINT ───────────────────────────────────────────────
@router.get("/feeds/status")
def get_feeds_status(db: Session = Depends(get_db)):
    """Per-source CTI feed health: total events, last event, 24h count."""
    from sqlalchemy import func, text

    results = db.execute(text("""
        SELECT
            source,
            COUNT(*) as total_events,
            MAX(ts) as last_event,
            ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(ts)))/60) as mins_since_last,
            SUM(CASE WHEN ts > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as events_24h,
            COUNT(DISTINCT vector) as vector_count
        FROM events
        GROUP BY source
        ORDER BY MAX(ts) DESC
    """)).fetchall()

    sources = {}
    total_all = 0
    for row in results:
        sources[row[0]] = {
            "total_events": row[1],
            "last_event": row[2].isoformat() if row[2] else None,
            "mins_since_last": float(row[3]) if row[3] is not None else None,
            "events_24h": int(row[4]),
            "vector_count": row[5],
        }
        total_all += row[1]

    # Per-source vector breakdown for last 24h
    vector_results = db.execute(text("""
        SELECT source, vector, COUNT(*) as cnt
        FROM events
        WHERE ts > NOW() - INTERVAL '24 hours'
        GROUP BY source, vector
        ORDER BY cnt DESC
    """)).fetchall()

    for row in vector_results:
        src = row[0]
        if src in sources:
            if "vectors_24h" not in sources[src]:
                sources[src]["vectors_24h"] = {}
            sources[src]["vectors_24h"][row[1]] = row[2]

    return {
        "sources": sources,
        "total_events": total_all,
        "source_count": len(sources),
    }
ENDPOINT_EOF
    ok "Added /v1/feeds/status endpoint to unified.py"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 2: FRONTEND — FeedStatusPanel component
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ PART 2: Frontend — FeedStatusPanel component"

# Copy component
cp "$APP_DIR/FeedStatusPanel.jsx" "$PANELS_DIR/FeedStatusPanel.jsx" 2>/dev/null || \
cp "$(dirname "$0")/FeedStatusPanel.jsx" "$PANELS_DIR/FeedStatusPanel.jsx" 2>/dev/null || \
fail "FeedStatusPanel.jsx not found — place it in $APP_DIR or alongside this script"
ok "Placed FeedStatusPanel.jsx"

# Update Panels/index.ts
INDEX="$PANELS_DIR/index.ts"
if ! grep -q "FeedStatusPanel" "$INDEX" 2>/dev/null; then
    echo "" >> "$INDEX"
    echo "// CTI Feed Status" >> "$INDEX"
    echo "export { default as FeedStatusPanel } from './FeedStatusPanel';" >> "$INDEX"
    ok "Added to Panels/index.ts"
else
    ok "Already in index.ts"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# PART 3: WIRE INTO GLOBE
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ PART 3: Wire into CyberWeatherGlobe.tsx"

# 3A: Import
if grep -q "FeedStatusPanel" "$GLOBE"; then
    ok "Import already present"
else
    if grep -q "LiveThreatTicker" "$GLOBE"; then
        sed -i "s|LiveThreatTicker }|LiveThreatTicker, FeedStatusPanel }|" "$GLOBE"
        ok "Added to barrel import"
    elif grep -q "NetworkFlowMathematics" "$GLOBE"; then
        sed -i "s|NetworkFlowMathematics }|NetworkFlowMathematics, FeedStatusPanel }|" "$GLOBE"
        ok "Added to barrel import"
    else
        sed -i "s|} from './Panels'|, FeedStatusPanel } from './Panels'|" "$GLOBE"
        ok "Added to barrel import"
    fi
fi

# 3B: State
if grep -q "showFeedStatus" "$GLOBE"; then
    ok "State already present"
else
    ANCHOR_LINE=$(grep -n "const \[showReplay," "$GLOBE" | head -1 | cut -d: -f1)
    if [ -z "$ANCHOR_LINE" ]; then
        ANCHOR_LINE=$(grep -n "const \[showFlowMath," "$GLOBE" | head -1 | cut -d: -f1)
    fi
    if [ -n "$ANCHOR_LINE" ]; then
        sed -i "${ANCHOR_LINE}a\\  const [showFeedStatus, setShowFeedStatus] = useState(false);" "$GLOBE"
        ok "Added state"
    else
        fail "Could not find insertion point for state"
    fi
fi

# 3C: Button — insert after the REPLAY button
if grep -q "FEEDS" "$GLOBE" && grep -q "setShowFeedStatus" "$GLOBE"; then
    ok "Button already present"
else
    # Find the REPLAY button's closing </button>
    REPLAY_BTN=$(grep -n "⏱ REPLAY" "$GLOBE" | head -1 | cut -d: -f1)
    if [ -n "$REPLAY_BTN" ]; then
        CLOSE_BTN=$(awk "NR>$REPLAY_BTN && /<\/button>/{print NR; exit}" "$GLOBE")
        if [ -n "$CLOSE_BTN" ]; then
            sed -i "${CLOSE_BTN}a\\
\\
          {/* ─── FEED STATUS BUTTON ─── */}\\
          <button\\
            onClick={() => setShowFeedStatus((v) => !v)}\\
            style={{\\
              display: \"flex\", flexDirection: \"column\", alignItems: \"center\",\\
              padding: \"6px 14px\", borderRadius: \"4px\",\\
              background: showFeedStatus ? \"rgba(34,197,94,0.15)\" : \"rgba(34,197,94,0.05)\",\\
              border: \`1px solid \${showFeedStatus ? \"rgba(34,197,94,0.5)\" : \"rgba(34,197,94,0.15)\"}\`,\\
              cursor: \"pointer\", transition: \"background 0.15s, border-color 0.15s\",\\
            }}\\
          >\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"9px\",\\
              color: \"rgba(34,197,94,0.6)\", letterSpacing: \"0.15em\", marginBottom: \"2px\",\\
            }}>\\
              STATUS\\
            </div>\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"13px\", fontWeight: 800,\\
              color: showFeedStatus ? \"#22c55e\" : \"rgba(34,197,94,0.6)\", letterSpacing: \"0.08em\",\\
            }}>\\
              📡 FEEDS\\
            </div>\\
          </button>" "$GLOBE"
            ok "Inserted button after REPLAY"
        else
            info "Could not find REPLAY closing tag — add button manually"
        fi
    else
        info "Could not find REPLAY button — add button manually"
    fi
fi

# 3D: Panel render
if grep -q "showFeedStatus &&" "$GLOBE"; then
    ok "Panel render already present"
else
    # Insert before the LiveThreatTicker or Keyframes
    TICKER_LINE=$(grep -n "LIVE THREAT FEED TICKER\|LiveThreatTicker" "$GLOBE" | head -1 | cut -d: -f1)
    if [ -z "$TICKER_LINE" ]; then
        TICKER_LINE=$(grep -n "{/\* Keyframes \*/}" "$GLOBE" | head -1 | cut -d: -f1)
    fi
    if [ -n "$TICKER_LINE" ]; then
        sed -i "${TICKER_LINE}i\\
\\
      {/* ─── CTI FEED STATUS ─── */}\\
      {showFeedStatus && (\\
        <FeedStatusPanel onClose={() => setShowFeedStatus(false)} />\\
      )}" "$GLOBE"
        ok "Inserted panel render"
    else
        fail "Could not find insertion point for panel"
    fi
fi

# 3E: Escape handler
if grep -q "setShowFeedStatus(false)" "$GLOBE"; then
    ok "Escape handler already patched"
else
    sed -i "s|setShowReplay(false);|setShowReplay(false); setShowFeedStatus(false);|" "$GLOBE"
    ok "Added to Escape handler"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# VALIDATE
# ═══════════════════════════════════════════════════════════════════════════

echo "▸ Validate"
ERRORS=0
grep -q "FeedStatusPanel" "$GLOBE"                || { echo -e "  ${RED}✗${NC} Missing import"; ERRORS=$((ERRORS+1)); }
grep -q "showFeedStatus" "$GLOBE"                  || { echo -e "  ${RED}✗${NC} Missing state"; ERRORS=$((ERRORS+1)); }
grep -q "setShowFeedStatus" "$GLOBE"               || { echo -e "  ${RED}✗${NC} Missing button"; ERRORS=$((ERRORS+1)); }
grep -q "feeds/status" "$ROUTER"                   || { echo -e "  ${RED}✗${NC} Missing backend endpoint"; ERRORS=$((ERRORS+1)); }
[ -f "$PANELS_DIR/FeedStatusPanel.jsx" ]           || { echo -e "  ${RED}✗${NC} Component missing"; ERRORS=$((ERRORS+1)); }
[ "$ERRORS" -gt 0 ] && fail "$ERRORS errors"
ok "All validated"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# BUILD & DEPLOY
# ═══════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════"
echo "  Ready to build"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Backend:   /v1/feeds/status endpoint added"
echo "  Frontend:  📡 FEEDS button + FeedStatusPanel"
echo ""
echo "  NOTE: Both frontend AND backend need rebuilding"
echo ""

read -p "  Build and deploy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$APP_DIR"
    info "Building frontend + backend..."
    docker compose build --no-cache frontend backend
    info "Deploying..."
    docker compose up -d
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  📡 FEEDS button in header → shows CTI feed health"
    echo "  Backend: /v1/feeds/status serving per-source stats"
    echo ""
    echo "  Test: curl https://weather.kulpritstudios.com/v1/feeds/status"
    echo ""
    echo "  Rollback: cp $BACKUP_DIR/* back to source locations"
    echo "═══════════════════════════════════════════════════════════"
else
    echo "  Skipped. Build manually with:"
    echo "    docker compose build --no-cache frontend backend && docker compose up -d"
fi
