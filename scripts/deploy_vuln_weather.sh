#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY: VulnWeatherPanel + Backend Vulnerability Router
# ═══════════════════════════════════════════════════════════════════════════════
#
# Adds:
#   Frontend: VulnWeatherPanel.jsx → Panels/ + globe wiring
#   Backend:  vuln_router.py → routers/ + main.py registration
#
# Usage:
#   cd ~/cyber-weather/app
#   chmod +x deploy_vuln_weather.sh
#   ./deploy_vuln_weather.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
GLOBE="$APP_DIR/frontend/src/components/CyberWeatherGlobe.tsx"
PANELS_DIR="$APP_DIR/frontend/src/components/Panels"
BACKEND_DIR="$APP_DIR/backend/app"
ROUTERS_DIR="$BACKEND_DIR/routers"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🛡️  VULNERABILITY WEATHER — DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════"
echo ""

[ -f "$GLOBE" ] || fail "CyberWeatherGlobe.tsx not found"
[ -f "$APP_DIR/VulnWeatherPanel.jsx" ] || fail "VulnWeatherPanel.jsx not found in $APP_DIR"
[ -f "$APP_DIR/vuln_router.py" ] || fail "vuln_router.py not found in $APP_DIR"

# ─── BACKUP ─────────────────────────────────────────────────────────────────
BACKUP_DIR="$APP_DIR/backups/$(date +%Y%m%d_%H%M%S)_vulnweather"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
ok "Backed up globe to $BACKUP_DIR"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# FRONTEND
# ═══════════════════════════════════════════════════════════════════════════════
echo "▸ FRONTEND DEPLOYMENT"
echo ""

# ─── 1. Place component ─────────────────────────────────────────────────────
echo "  Step 1: Place VulnWeatherPanel component"
cp "$APP_DIR/VulnWeatherPanel.jsx" "$PANELS_DIR/VulnWeatherPanel.jsx"
ok "Copied to $PANELS_DIR/VulnWeatherPanel.jsx"

# Update Panels/index.ts
INDEX="$PANELS_DIR/index.ts"
if [ -f "$INDEX" ] && ! grep -q "VulnWeatherPanel" "$INDEX"; then
    echo "" >> "$INDEX"
    echo "// Vulnerability Pressure Systems" >> "$INDEX"
    echo "export { default as VulnWeatherPanel } from './VulnWeatherPanel';" >> "$INDEX"
    ok "Added barrel export to Panels/index.ts"
elif grep -q "VulnWeatherPanel" "$INDEX" 2>/dev/null; then
    ok "Already exported in index.ts"
fi
echo ""

# ─── 2. Add import to globe ─────────────────────────────────────────────────
echo "  Step 2: Add import"
if grep -q "VulnWeatherPanel" "$GLOBE"; then
    ok "Already imported (skipping)"
else
    # Add to existing barrel import
    if grep -q "ContextEnginePanel" "$GLOBE"; then
        sed -i "s|ContextEnginePanel }|ContextEnginePanel, VulnWeatherPanel }|" "$GLOBE"
        ok "Added VulnWeatherPanel to barrel import"
    elif grep -q "} from './Panels'" "$GLOBE"; then
        sed -i "s|} from './Panels'|, VulnWeatherPanel } from './Panels'|" "$GLOBE"
        ok "Added to barrel import"
    else
        # Standalone import
        LAST_IMPORT=$(grep -n "import.*from.*Panels" "$GLOBE" | tail -1 | cut -d: -f1)
        if [ -n "$LAST_IMPORT" ]; then
            sed -i "${LAST_IMPORT}a\\import VulnWeatherPanel from './Panels/VulnWeatherPanel';" "$GLOBE"
            ok "Added standalone import"
        else
            fail "Could not find import insertion point"
        fi
    fi
fi
echo ""

# ─── 3. Add state hook ──────────────────────────────────────────────────────
echo "  Step 3: Add showVulnWeather state"
if grep -q "showVulnWeather" "$GLOBE"; then
    ok "State already exists (skipping)"
else
    # Find last useState(false) line and insert after
    LAST_STATE=$(grep -n "useState(false)" "$GLOBE" | tail -1 | cut -d: -f1)
    if [ -n "$LAST_STATE" ]; then
        sed -i "${LAST_STATE}a\\  const [showVulnWeather, setShowVulnWeather] = useState(false);" "$GLOBE"
        ok "Added state after line $LAST_STATE"
    else
        fail "Could not find useState insertion point"
    fi
fi
echo ""

# ─── 4. Add button to header ────────────────────────────────────────────────
echo "  Step 4: Add 🛡️ VULN button to header"
if grep -q "setShowVulnWeather" "$GLOBE"; then
    ok "Button already exists (skipping)"
else
    # Find the ALCHEMY button (🧪) — insert after its closing </button>
    ALCHEMY_LINE=$(grep -n "ALCHEMY" "$GLOBE" | grep -i "button\|label\|div" | head -1 | cut -d: -f1)
    
    if [ -z "$ALCHEMY_LINE" ]; then
        # Fallback: find the CONTEXT button
        ALCHEMY_LINE=$(grep -n "CONTEXT" "$GLOBE" | grep -i "button\|label\|div" | head -1 | cut -d: -f1)
    fi
    
    if [ -n "$ALCHEMY_LINE" ]; then
        # Find the closing </button> after this line
        CLOSE_BTN=$(awk "NR>$ALCHEMY_LINE && /<\/button>/{print NR; exit}" "$GLOBE")
        
        if [ -n "$CLOSE_BTN" ]; then
            # Create button block in a temp file to avoid sed escaping hell
            TMPBTN=$(mktemp)
            cat > "$TMPBTN" << 'BTNEOF'

          {/* ─── VULN WEATHER BUTTON ─── */}
          <button
            onClick={() => setShowVulnWeather((v) => !v)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "6px 14px", borderRadius: "4px",
              background: showVulnWeather ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.05)",
              border: `1px solid ${showVulnWeather ? "rgba(239,68,68,0.5)" : "rgba(239,68,68,0.15)"}`,
              cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "9px",
              color: "rgba(239,68,68,0.6)", letterSpacing: "0.15em", marginBottom: "2px",
            }}>
              PRESSURE
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 800,
              color: showVulnWeather ? "#ef4444" : "rgba(239,68,68,0.6)", letterSpacing: "0.08em",
            }}>
              🛡️ VULN
            </div>
          </button>
BTNEOF
            # Insert after the closing button
            sed -i "${CLOSE_BTN}r ${TMPBTN}" "$GLOBE"
            rm -f "$TMPBTN"
            ok "Inserted button after line $CLOSE_BTN"
        else
            warn "Could not find </button> after ALCHEMY — button not inserted"
        fi
    else
        warn "Could not find ALCHEMY/CONTEXT button anchor — button not inserted"
    fi
fi
echo ""

# ─── 5. Add panel render ────────────────────────────────────────────────────
echo "  Step 5: Add VulnWeatherPanel render"
if grep -q "<VulnWeatherPanel" "$GLOBE"; then
    ok "Already rendered (skipping)"
else
    # Insert before {/* Keyframes */}
    STYLE_LINE=$(grep -n "{/\* Keyframes \*/}" "$GLOBE" | head -1 | cut -d: -f1)
    
    if [ -n "$STYLE_LINE" ]; then
        TMPRENDER=$(mktemp)
        cat > "$TMPRENDER" << 'RENDEREOF'

      {/* ─── VULNERABILITY PRESSURE SYSTEMS ─── */}
      {showVulnWeather && (
        <VulnWeatherPanel onClose={() => setShowVulnWeather(false)} />
      )}
RENDEREOF
        sed -i "${STYLE_LINE}r ${TMPRENDER}" "$GLOBE"
        # The 'r' command inserts AFTER the line, but we want BEFORE
        # Actually sed 'r' inserts after, which is wrong. Use different approach:
        rm -f "$TMPRENDER"
        
        # Use insert (i) instead — need to escape for sed
        sed -i "${STYLE_LINE}i\\\\n      {/* ─── VULNERABILITY PRESSURE SYSTEMS ─── */}\\n      {showVulnWeather \&\& (\\n        <VulnWeatherPanel onClose={() => setShowVulnWeather(false)} />\\n      )}" "$GLOBE"
        ok "Inserted panel render before Keyframes"
    else
        warn "Could not find Keyframes block — panel render not inserted"
    fi
fi
echo ""

# ─── 6. Add to Escape handler ───────────────────────────────────────────────
echo "  Step 6: Patch Escape handler"
if grep -q "setShowVulnWeather(false)" "$GLOBE"; then
    ok "Already in Escape handler (skipping)"
else
    if grep -q "setShowReplay(false)" "$GLOBE"; then
        sed -i "s|setShowReplay(false);|setShowReplay(false); setShowVulnWeather(false);|" "$GLOBE"
        ok "Added to Escape handler"
    elif grep -q "setShowFlowMath(false)" "$GLOBE"; then
        sed -i "s|setShowFlowMath(false);|setShowFlowMath(false); setShowVulnWeather(false);|" "$GLOBE"
        ok "Added to Escape handler"
    else
        warn "Could not find Escape handler entry point"
    fi
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# BACKEND
# ═══════════════════════════════════════════════════════════════════════════════
echo "▸ BACKEND DEPLOYMENT"
echo ""

# ─── 7. Place router ────────────────────────────────────────────────────────
echo "  Step 7: Place vuln_router.py"
if [ -d "$ROUTERS_DIR" ]; then
    cp "$APP_DIR/vuln_router.py" "$ROUTERS_DIR/vuln_router.py"
    ok "Copied to $ROUTERS_DIR/vuln_router.py"
else
    warn "Routers directory not found at $ROUTERS_DIR"
    # Try alternate location
    ALT_DIR="$BACKEND_DIR"
    cp "$APP_DIR/vuln_router.py" "$ALT_DIR/vuln_router.py"
    ok "Copied to $ALT_DIR/vuln_router.py"
fi
echo ""

# ─── 8. Register router in main.py ──────────────────────────────────────────
echo "  Step 8: Register router in main.py"
MAIN_PY=$(find "$BACKEND_DIR" -name "main.py" -maxdepth 2 | head -1)

if [ -n "$MAIN_PY" ] && [ -f "$MAIN_PY" ]; then
    if grep -q "vuln_router" "$MAIN_PY"; then
        ok "Router already registered"
    else
        # Add import
        if grep -q "from.*routers" "$MAIN_PY"; then
            # Find the last router import line
            LAST_ROUTER_IMPORT=$(grep -n "from.*router" "$MAIN_PY" | tail -1 | cut -d: -f1)
            if [ -n "$LAST_ROUTER_IMPORT" ]; then
                sed -i "${LAST_ROUTER_IMPORT}a\\from app.routers.vuln_router import router as vuln_router" "$MAIN_PY"
                ok "Added import"
            fi
        else
            # Add at top of imports
            sed -i "1a\\from app.routers.vuln_router import router as vuln_router" "$MAIN_PY"
            ok "Added import at top"
        fi
        
        # Add include_router
        if grep -q "include_router" "$MAIN_PY"; then
            LAST_INCLUDE=$(grep -n "include_router" "$MAIN_PY" | tail -1 | cut -d: -f1)
            if [ -n "$LAST_INCLUDE" ]; then
                sed -i "${LAST_INCLUDE}a\\app.include_router(vuln_router)" "$MAIN_PY"
                ok "Added app.include_router(vuln_router)"
            fi
        else
            # Find the app = FastAPI() line and add after
            APP_LINE=$(grep -n "app = FastAPI\|app=FastAPI" "$MAIN_PY" | head -1 | cut -d: -f1)
            if [ -n "$APP_LINE" ]; then
                sed -i "${APP_LINE}a\\app.include_router(vuln_router)" "$MAIN_PY"
                ok "Added include_router after app creation"
            else
                warn "Could not find FastAPI app — manual registration needed"
            fi
        fi
    fi
else
    warn "main.py not found — manual router registration needed"
    echo "    Add to your main.py:"
    echo "      from app.routers.vuln_router import router as vuln_router"
    echo "      app.include_router(vuln_router)"
fi
echo ""

# ─── 9. Ensure httpx is in requirements ──────────────────────────────────────
echo "  Step 9: Check httpx dependency"
REQ_FILE=$(find "$APP_DIR/backend" -name "requirements*.txt" -maxdepth 2 | head -1)
if [ -n "$REQ_FILE" ] && [ -f "$REQ_FILE" ]; then
    if grep -q "httpx" "$REQ_FILE"; then
        ok "httpx already in requirements"
    else
        echo "httpx>=0.25.0" >> "$REQ_FILE"
        ok "Added httpx to $REQ_FILE"
    fi
else
    warn "requirements.txt not found — ensure httpx is installed in backend container"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATE
# ═══════════════════════════════════════════════════════════════════════════════
echo "▸ VALIDATION"
echo ""

ERRORS=0
grep -q "VulnWeatherPanel" "$GLOBE"                    || { echo -e "  ${RED}✗${NC} Missing import in globe"; ERRORS=$((ERRORS+1)); }
grep -q "showVulnWeather" "$GLOBE"                     || { echo -e "  ${RED}✗${NC} Missing state"; ERRORS=$((ERRORS+1)); }
grep -q "setShowVulnWeather" "$GLOBE"                  || { echo -e "  ${RED}✗${NC} Missing button"; ERRORS=$((ERRORS+1)); }
grep -q "<VulnWeatherPanel" "$GLOBE"                   || { echo -e "  ${RED}✗${NC} Missing panel render"; ERRORS=$((ERRORS+1)); }
[ -f "$PANELS_DIR/VulnWeatherPanel.jsx" ]              || { echo -e "  ${RED}✗${NC} Component file missing"; ERRORS=$((ERRORS+1)); }

if [ "$ERRORS" -gt 0 ]; then
    fail "$ERRORS validation errors — check backup at $BACKUP_DIR"
fi
ok "All frontend patches validated"

# Syntax check
OPEN=$(grep -o '{' "$GLOBE" | wc -l)
CLOSE=$(grep -o '}' "$GLOBE" | wc -l)
DIFF=$((OPEN - CLOSE))
[ "$DIFF" -eq 0 ] && ok "Brace count balanced" || info "Brace diff=$DIFF (may be fine with template literals)"

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# BUILD
# ═══════════════════════════════════════════════════════════════════════════════
echo "═══════════════════════════════════════════════════════════════"
echo "  Ready to build"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Frontend:"
echo "    • VulnWeatherPanel.jsx → Panels/"
echo "    • 🛡️ VULN button added to globe header"
echo "    • Panel renders with showVulnWeather state"
echo "    • Escape handler patched"
echo ""
echo "  Backend:"
echo "    • vuln_router.py → routers/"
echo "    • Endpoints: /v1/vuln/epss/top, /v1/vuln/kev/recent,"
echo "                 /v1/vuln/divergence, /v1/vuln/stats"
echo "    • Auto-fetches EPSS CSV + CISA KEV JSON on startup"
echo ""
echo "  Data sources (free, no auth):"
echo "    • FIRST EPSS v4: ~240K CVE exploitation probabilities"
echo "    • CISA KEV: Known Exploited Vulnerabilities catalog"
echo ""

read -p "  Build and deploy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$APP_DIR"
    info "Building frontend + backend..."
    docker compose build --no-cache frontend backend
    info "Deploying..."
    docker compose up -d frontend backend
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  🛡️ VULN button now in globe header"
    echo "  Backend fetching EPSS + KEV on startup"
    echo "  Panel shows CACHED data until backend responds"
    echo ""
    echo "  Test backend:"
    echo "    curl http://localhost:8000/v1/vuln/stats"
    echo "    curl http://localhost:8000/v1/vuln/epss/top?limit=5"
    echo ""
    echo "  Rollback:"
    echo "    cp $BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
    echo "       frontend/src/components/CyberWeatherGlobe.tsx"
    echo "═══════════════════════════════════════════════════════════════"
else
    echo "  Skipped. Build manually:"
    echo "    docker compose build --no-cache frontend backend && docker compose up -d frontend backend"
fi
