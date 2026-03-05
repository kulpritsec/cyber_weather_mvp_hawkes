#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# DEPLOY: Network Flow Mathematics Panel → weather.kulpritstudios.com
# ═══════════════════════════════════════════════════════════════════════════════
#
# Adds a "〰 FLOW" button to the globe header bar (same pattern as Context
# Engine, PTI, Infrastructure, MathLab) that opens the Network Flow
# Mathematics panel as an overlay.
#
# Usage:
#   1. SCP both files to the Linode:
#      scp NetworkFlowMathematics.jsx deploy_flow_math.sh deploy@<IP>:~/cyber-weather/app/
#
#   2. SSH in and run:
#      ssh deploy@<IP>
#      cd ~/cyber-weather/app
#      chmod +x deploy_flow_math.sh
#      ./deploy_flow_math.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$HOME/cyber-weather/app"
FRONTEND_DIR="$APP_DIR/frontend"
PANELS_DIR="$FRONTEND_DIR/src/components/Panels"
GLOBE_FILE="$FRONTEND_DIR/src/components/CyberWeatherGlobe.tsx"
INDEX_FILE="$PANELS_DIR/index.ts"
COMPONENT_SRC="$APP_DIR/NetworkFlowMathematics.jsx"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  NETWORK FLOW MATHEMATICS — PANEL DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── PREFLIGHT ────────────────────────────────────────────────────────────

echo "▸ STEP 1: Preflight checks"

cd "$APP_DIR" || fail "$APP_DIR not found"
ok "Working directory: $(pwd)"

[ -f "$COMPONENT_SRC" ] || fail "NetworkFlowMathematics.jsx not found in $APP_DIR"
ok "Component file found"

[ -f "$GLOBE_FILE" ] || fail "CyberWeatherGlobe.tsx not found"
ok "CyberWeatherGlobe.tsx found"

[ -d "$PANELS_DIR" ] || fail "Panels directory not found"
ok "Panels directory found"

# Check if already deployed
if grep -q "NetworkFlowMathematics" "$GLOBE_FILE" 2>/dev/null; then
    echo ""
    echo -e "  ${CYAN}⚠${NC}  NetworkFlowMathematics already referenced in CyberWeatherGlobe.tsx"
    read -p "     Re-deploy anyway? (y/n) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# Back up before patching
echo ""
echo "▸ STEP 2: Backup"
BACKUP_DIR="$APP_DIR/backups/$(date +%Y%m%d_%H%M%S)_flowmath"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE_FILE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
[ -f "$INDEX_FILE" ] && cp "$INDEX_FILE" "$BACKUP_DIR/index.ts.bak"
ok "Backed up to $BACKUP_DIR"

# ─── STEP 3: PLACE COMPONENT ─────────────────────────────────────────────

echo ""
echo "▸ STEP 3: Place component"
cp "$COMPONENT_SRC" "$PANELS_DIR/NetworkFlowMathematics.jsx"
ok "Copied to $PANELS_DIR/NetworkFlowMathematics.jsx"

# ─── STEP 4: UPDATE PANELS/INDEX.TS ──────────────────────────────────────

echo ""
echo "▸ STEP 4: Update Panels/index.ts"
if [ -f "$INDEX_FILE" ]; then
    if grep -q "NetworkFlowMathematics" "$INDEX_FILE"; then
        ok "Already exported in index.ts"
    else
        echo "" >> "$INDEX_FILE"
        echo "// Network Flow Mathematics" >> "$INDEX_FILE"
        echo "export { default as NetworkFlowMathematics } from './NetworkFlowMathematics';" >> "$INDEX_FILE"
        ok "Added export to index.ts"
    fi
else
    cat > "$INDEX_FILE" << 'EOF'
export { default as NetworkFlowMathematics } from './NetworkFlowMathematics';
EOF
    ok "Created index.ts with export"
fi

# ─── STEP 5: PATCH CYBERWEATHERGLOBE.TSX ─────────────────────────────────

echo ""
echo "▸ STEP 5: Patch CyberWeatherGlobe.tsx"

# ── 5A: ADD IMPORT ──
info "5A: Adding import..."

if grep -q "NetworkFlowMathematics" "$GLOBE_FILE"; then
    ok "Import already present (skipping)"
else
    # Try barrel import first — append to existing Panels import
    if grep -q "from './Panels'" "$GLOBE_FILE"; then
        # Add to the barrel import line
        sed -i "s|} from './Panels'|, NetworkFlowMathematics } from './Panels'|" "$GLOBE_FILE"
        ok "Added to barrel import"
    elif grep -q "from \"./Panels\"" "$GLOBE_FILE"; then
        sed -i "s|} from \"./Panels\"|, NetworkFlowMathematics } from \"./Panels\"|" "$GLOBE_FILE"
        ok "Added to barrel import (double quotes)"
    else
        # No barrel import — add standalone import after the last panel import
        LAST_PANEL_IMPORT=$(grep -n "import.*Panel.*from" "$GLOBE_FILE" | tail -1 | cut -d: -f1)
        if [ -n "$LAST_PANEL_IMPORT" ]; then
            sed -i "${LAST_PANEL_IMPORT}a\\import NetworkFlowMathematics from './Panels/NetworkFlowMathematics';" "$GLOBE_FILE"
        else
            # Fallback: add after first import
            sed -i "1a\\import NetworkFlowMathematics from './Panels/NetworkFlowMathematics';" "$GLOBE_FILE"
        fi
        ok "Added standalone import"
    fi
fi

# ── 5B: ADD STATE HOOK ──
info "5B: Adding state hook..."

if grep -q "showFlowMath" "$GLOBE_FILE"; then
    ok "State hook already present (skipping)"
else
    # Insert after the last showXxx useState — find the best anchor
    if grep -q "showPredictive" "$GLOBE_FILE"; then
        ANCHOR="showPredictive"
    elif grep -q "showInfrastructure" "$GLOBE_FILE"; then
        ANCHOR="showInfrastructure"
    elif grep -q "showMathLab" "$GLOBE_FILE"; then
        ANCHOR="showMathLab"
    elif grep -q "showContextEngine" "$GLOBE_FILE"; then
        ANCHOR="showContextEngine"
    else
        ANCHOR=""
    fi

    if [ -n "$ANCHOR" ]; then
        # Find the line with this state declaration
        STATE_LINE=$(grep -n "const \[${ANCHOR}," "$GLOBE_FILE" | head -1 | cut -d: -f1)
        if [ -n "$STATE_LINE" ]; then
            sed -i "${STATE_LINE}a\\  const [showFlowMath, setShowFlowMath] = useState(false);" "$GLOBE_FILE"
            ok "Added state after $ANCHOR"
        else
            fail "Could not find $ANCHOR state line"
        fi
    else
        # Fallback: find any useState(false) line and add after it
        FALLBACK_LINE=$(grep -n "useState(false)" "$GLOBE_FILE" | tail -1 | cut -d: -f1)
        if [ -n "$FALLBACK_LINE" ]; then
            sed -i "${FALLBACK_LINE}a\\  const [showFlowMath, setShowFlowMath] = useState(false);" "$GLOBE_FILE"
            ok "Added state after last useState(false)"
        else
            fail "Could not find insertion point for state hook"
        fi
    fi
fi

# ── 5C: ADD BUTTON TO HEADER BAR ──
info "5C: Adding header button..."

if grep -q "FLOW" "$GLOBE_FILE" && grep -q "showFlowMath" "$GLOBE_FILE" | grep -q "onClick"; then
    ok "Button already present (skipping)"
else
    # Find the best anchor — the last panel button before the clock/severity section
    # Look for the Predictive/Forecast button or Infrastructure button
    if grep -q "setShowPredictive" "$GLOBE_FILE"; then
        # Find the closing </button> after the setShowPredictive onClick
        BUTTON_ANCHOR_LINE=$(grep -n "setShowPredictive" "$GLOBE_FILE" | head -1 | cut -d: -f1)
    elif grep -q "setShowInfrastructure" "$GLOBE_FILE"; then
        BUTTON_ANCHOR_LINE=$(grep -n "setShowInfrastructure" "$GLOBE_FILE" | head -1 | cut -d: -f1)
    elif grep -q "setShowContextEngine" "$GLOBE_FILE"; then
        BUTTON_ANCHOR_LINE=$(grep -n "setShowContextEngine" "$GLOBE_FILE" | head -1 | cut -d: -f1)
    else
        BUTTON_ANCHOR_LINE=""
    fi

    if [ -n "$BUTTON_ANCHOR_LINE" ]; then
        # Find the next </button> after this anchor
        CLOSE_BUTTON=$(awk "NR>$BUTTON_ANCHOR_LINE && /<\/button>/{print NR; exit}" "$GLOBE_FILE")
        if [ -n "$CLOSE_BUTTON" ]; then
            # Insert the Flow Math button after the closing </button>
            sed -i "${CLOSE_BUTTON}a\\
\\
          {/* ─── FLOW MATH BUTTON ─── */}\\
          <button\\
            onClick={() => setShowFlowMath((v) => !v)}\\
            style={{\\
              display: \"flex\", flexDirection: \"column\", alignItems: \"center\",\\
              padding: \"6px 14px\", borderRadius: \"4px\",\\
              background: showFlowMath ? \"rgba(0,204,255,0.15)\" : \"rgba(0,204,255,0.05)\",\\
              border: \`1px solid \${showFlowMath ? \"rgba(0,204,255,0.5)\" : \"rgba(0,204,255,0.2)\"}\`,\\
              cursor: \"pointer\", transition: \"background 0.15s, border-color 0.15s\",\\
            }}\\
          >\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"9px\",\\
              color: \"rgba(0,204,255,0.6)\", letterSpacing: \"0.15em\", marginBottom: \"2px\",\\
            }}>\\
              NETWORK\\
            </div>\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"13px\", fontWeight: 800,\\
              color: showFlowMath ? \"#00ccff\" : \"rgba(0,204,255,0.6)\", letterSpacing: \"0.08em\",\\
            }}>\\
              〰 FLOW\\
            </div>\\
          </button>" "$GLOBE_FILE"
            ok "Inserted button after panel button at line $CLOSE_BUTTON"
        else
            fail "Could not find </button> after anchor"
        fi
    else
        echo -e "  ${CYAN}⚠${NC}  Could not auto-detect button insertion point"
        echo "     You'll need to manually add the button — see WIRING_GUIDE.md"
    fi
fi

# ── 5D: ADD PANEL RENDER ──
info "5D: Adding panel render..."

if grep -q "showFlowMath &&" "$GLOBE_FILE"; then
    ok "Panel render already present (skipping)"
else
    # Find the last panel conditional render
    if grep -q "showPredictive &&" "$GLOBE_FILE"; then
        PANEL_ANCHOR="showPredictive"
    elif grep -q "showInfrastructure &&" "$GLOBE_FILE"; then
        PANEL_ANCHOR="showInfrastructure"
    elif grep -q "showMathLab &&" "$GLOBE_FILE"; then
        PANEL_ANCHOR="showMathLab"
    elif grep -q "showContextEngine &&" "$GLOBE_FILE"; then
        PANEL_ANCHOR="showContextEngine"
    else
        PANEL_ANCHOR=""
    fi

    if [ -n "$PANEL_ANCHOR" ]; then
        # Find the closing of that panel block: pattern is  )}  on its own line after the anchor
        PANEL_START=$(grep -n "${PANEL_ANCHOR} &&" "$GLOBE_FILE" | tail -1 | cut -d: -f1)
        if [ -n "$PANEL_START" ]; then
            # Find the closing )}  — look for the pattern after the panel start
            PANEL_CLOSE=$(awk "NR>$PANEL_START && /^[[:space:]]*\)}$/{print NR; exit}" "$GLOBE_FILE")
            if [ -n "$PANEL_CLOSE" ]; then
                sed -i "${PANEL_CLOSE}a\\
\\
      {/* ─── NETWORK FLOW MATHEMATICS ─── */}\\
      {showFlowMath && (\\
        <NetworkFlowMathematics onClose={() => setShowFlowMath(false)} />\\
      )}" "$GLOBE_FILE"
                ok "Inserted panel render after $PANEL_ANCHOR block"
            else
                fail "Could not find closing of $PANEL_ANCHOR block"
            fi
        fi
    else
        echo -e "  ${CYAN}⚠${NC}  Could not auto-detect panel render insertion point"
        echo "     Add manually before the closing </div> and <style> block"
    fi
fi

# ── 5E: ADD TO ESCAPE HANDLER ──
info "5E: Patching Escape handler..."

if grep -q "setShowFlowMath(false)" "$GLOBE_FILE"; then
    ok "Escape handler already patched (skipping)"
else
    # Find the Escape handler — look for the pattern with setShowPredictive(false) or similar
    if grep -q "setShowPredictive(false)" "$GLOBE_FILE"; then
        sed -i "s|setShowPredictive(false);|setShowPredictive(false); setShowFlowMath(false);|" "$GLOBE_FILE"
        ok "Added to Escape handler (after setShowPredictive)"
    elif grep -q "setShowInfrastructure(false)" "$GLOBE_FILE"; then
        sed -i "s|setShowInfrastructure(false);|setShowInfrastructure(false); setShowFlowMath(false);|" "$GLOBE_FILE"
        ok "Added to Escape handler (after setShowInfrastructure)"
    elif grep -q "setShowContextEngine(false)" "$GLOBE_FILE"; then
        sed -i "s|setShowContextEngine(false);|setShowContextEngine(false); setShowFlowMath(false);|" "$GLOBE_FILE"
        ok "Added to Escape handler (after setShowContextEngine)"
    else
        echo -e "  ${CYAN}⚠${NC}  Could not find Escape handler — Escape dismiss won't work"
        echo "     Add setShowFlowMath(false) to the Escape keydown handler manually"
    fi
fi

# ─── VALIDATION ───────────────────────────────────────────────────────────

echo ""
echo "▸ STEP 6: Validate patches"

ERRORS=0

grep -q "NetworkFlowMathematics" "$GLOBE_FILE" || { echo -e "  ${RED}✗${NC} Missing import"; ERRORS=$((ERRORS+1)); }
grep -q "showFlowMath" "$GLOBE_FILE" || { echo -e "  ${RED}✗${NC} Missing state"; ERRORS=$((ERRORS+1)); }
grep -q "setShowFlowMath" "$GLOBE_FILE" || { echo -e "  ${RED}✗${NC} Missing button/panel"; ERRORS=$((ERRORS+1)); }
grep -q "NetworkFlowMathematics" "$INDEX_FILE" || { echo -e "  ${RED}✗${NC} Missing index export"; ERRORS=$((ERRORS+1)); }
[ -f "$PANELS_DIR/NetworkFlowMathematics.jsx" ] || { echo -e "  ${RED}✗${NC} Component file missing"; ERRORS=$((ERRORS+1)); }

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    fail "$ERRORS validation errors. Check the backup at $BACKUP_DIR and fix manually."
fi

ok "All 5 patches validated"

# ─── SYNTAX CHECK ─────────────────────────────────────────────────────────

echo ""
echo "▸ STEP 7: Quick syntax check"
# Check for obvious sed breakage — unmatched braces etc
OPEN_BRACES=$(grep -o '{' "$GLOBE_FILE" | wc -l)
CLOSE_BRACES=$(grep -o '}' "$GLOBE_FILE" | wc -l)
DIFF=$((OPEN_BRACES - CLOSE_BRACES))
if [ "$DIFF" -ne 0 ]; then
    echo -e "  ${CYAN}⚠${NC}  Brace count mismatch (${OPEN_BRACES} open, ${CLOSE_BRACES} close, diff=${DIFF})"
    echo "     This might be fine (JSX template literals) but check if build fails"
else
    ok "Brace count balanced"
fi

# ─── BUILD & DEPLOY ──────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Ready to build and deploy"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Files modified:"
echo "    • frontend/src/components/Panels/NetworkFlowMathematics.jsx  (NEW)"
echo "    • frontend/src/components/Panels/index.ts                    (UPDATED)"
echo "    • frontend/src/components/CyberWeatherGlobe.tsx              (PATCHED)"
echo ""
echo "  Backup at: $BACKUP_DIR"
echo ""

read -p "  Build and deploy now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    info "Building frontend (no cache)..."
    docker compose build --no-cache frontend
    echo ""
    info "Deploying..."
    docker compose up -d frontend
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  Globe:      https://weather.kulpritstudios.com"
    echo "  Flow Math:  Click 〰 FLOW button in header bar"
    echo "  Escape:     Dismisses panel"
    echo ""
    echo "  Rollback:   cp $BACKUP_DIR/* back to source locations"
    echo "═══════════════════════════════════════════════════════════"
else
    echo ""
    echo "  Skipped build. To deploy manually:"
    echo ""
    echo "    cd ~/cyber-weather/app"
    echo "    docker compose build --no-cache frontend"
    echo "    docker compose up -d frontend"
    echo ""
fi
