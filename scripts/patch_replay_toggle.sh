#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# PATCH: Add ⏱ REPLAY toggle button to CyberWeatherGlobe header bar
# ═══════════════════════════════════════════════════════════════════════════════
#
# The TemporalReplayControls component already exists and is wired, but it's
# always visible. This patch:
#   1. Adds showReplay state hook
#   2. Adds ⏱ REPLAY button in the header (after PTI button)
#   3. Wraps the existing <TemporalReplayControls> in {showReplay && (...)}
#   4. Adds showReplay to the Escape handler
#
# Usage:
#   cd ~/cyber-weather/app
#   chmod +x patch_replay_toggle.sh
#   ./patch_replay_toggle.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

GLOBE="$HOME/cyber-weather/app/frontend/src/components/CyberWeatherGlobe.tsx"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  REPLAY TOGGLE — PATCH"
echo "═══════════════════════════════════════════════════════════"
echo ""

[ -f "$GLOBE" ] || fail "CyberWeatherGlobe.tsx not found"

# ─── BACKUP ───────────────────────────────────────────────────────────────
BACKUP_DIR="$HOME/cyber-weather/app/backups/$(date +%Y%m%d_%H%M%S)_replay"
mkdir -p "$BACKUP_DIR"
cp "$GLOBE" "$BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
ok "Backed up to $BACKUP_DIR"
echo ""

# ─── 1. ADD showReplay STATE ─────────────────────────────────────────────
echo "▸ STEP 1: Add showReplay state"

if grep -q "showReplay" "$GLOBE"; then
    ok "showReplay already exists (skipping)"
else
    # Insert after showFlowMath state (just added in previous deploy)
    if grep -q "showFlowMath" "$GLOBE"; then
        ANCHOR_LINE=$(grep -n "const \[showFlowMath," "$GLOBE" | head -1 | cut -d: -f1)
    elif grep -q "showThreatIntel" "$GLOBE"; then
        ANCHOR_LINE=$(grep -n "const \[showThreatIntel," "$GLOBE" | head -1 | cut -d: -f1)
    elif grep -q "showInfrastructure" "$GLOBE"; then
        ANCHOR_LINE=$(grep -n "const \[showInfrastructure," "$GLOBE" | head -1 | cut -d: -f1)
    else
        ANCHOR_LINE=$(grep -n "useState(false)" "$GLOBE" | tail -1 | cut -d: -f1)
    fi

    if [ -n "$ANCHOR_LINE" ]; then
        sed -i "${ANCHOR_LINE}a\\  const [showReplay, setShowReplay] = useState(false);" "$GLOBE"
        ok "Added state after line $ANCHOR_LINE"
    else
        fail "Could not find insertion point for state"
    fi
fi
echo ""

# ─── 2. ADD ⏱ REPLAY BUTTON ─────────────────────────────────────────────
echo "▸ STEP 2: Add REPLAY button to header"

if grep -q "setShowReplay" "$GLOBE"; then
    ok "Replay button already exists (skipping)"
else
    # Insert after the PTI button's closing </button> tag
    # PTI is the last panel button — find setShowThreatIntel onClick
    PTI_LINE=$(grep -n "setShowThreatIntel" "$GLOBE" | head -1 | cut -d: -f1)

    if [ -n "$PTI_LINE" ]; then
        # Find the closing </button> after the PTI button
        CLOSE_BTN=$(awk "NR>$PTI_LINE && /<\/button>/{print NR; exit}" "$GLOBE")

        if [ -n "$CLOSE_BTN" ]; then
            sed -i "${CLOSE_BTN}a\\
\\
          {/* ─── REPLAY BUTTON ─── */}\\
          <button\\
            onClick={() => setShowReplay((v) => !v)}\\
            style={{\\
              display: \"flex\", flexDirection: \"column\", alignItems: \"center\",\\
              padding: \"6px 14px\", borderRadius: \"4px\",\\
              background: showReplay ? \"rgba(0,204,255,0.15)\" : \"rgba(0,204,255,0.05)\",\\
              border: \`1px solid \${showReplay ? \"rgba(0,204,255,0.5)\" : \"rgba(0,204,255,0.15)\"}\`,\\
              cursor: \"pointer\", transition: \"background 0.15s, border-color 0.15s\",\\
            }}\\
          >\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"9px\",\\
              color: \"rgba(0,204,255,0.6)\", letterSpacing: \"0.15em\", marginBottom: \"2px\",\\
            }}>\\
              TEMPORAL\\
            </div>\\
            <div style={{\\
              fontFamily: \"'JetBrains Mono', monospace\", fontSize: \"13px\", fontWeight: 800,\\
              color: showReplay ? \"#00ccff\" : \"rgba(0,204,255,0.6)\", letterSpacing: \"0.08em\",\\
            }}>\\
              ⏱ REPLAY\\
            </div>\\
          </button>" "$GLOBE"
            ok "Inserted button after PTI button at line $CLOSE_BTN"
        else
            fail "Could not find </button> after PTI"
        fi
    else
        fail "Could not find PTI button anchor"
    fi
fi
echo ""

# ─── 3. WRAP TemporalReplayControls IN CONDITIONAL ──────────────────────
echo "▸ STEP 3: Wrap TemporalReplayControls in showReplay conditional"

# Check if already wrapped
if grep -q "showReplay &&" "$GLOBE"; then
    ok "Already conditionally rendered (skipping)"
else
    # Find the existing render line:
    #   {/* ─── TEMPORAL REPLAY CONTROLS ─── */}
    #   <TemporalReplayControls
    COMMENT_LINE=$(grep -n "TEMPORAL REPLAY CONTROLS" "$GLOBE" | head -1 | cut -d: -f1)

    if [ -n "$COMMENT_LINE" ]; then
        # Find the closing /> of the TemporalReplayControls self-closing tag
        COMPONENT_START=$((COMMENT_LINE + 1))
        COMPONENT_CLOSE=$(awk "NR>=$COMPONENT_START && /\/>/{print NR; exit}" "$GLOBE")

        if [ -n "$COMPONENT_CLOSE" ]; then
            # Replace the comment line with conditional open
            sed -i "${COMMENT_LINE}s|.*|      {/* ─── TEMPORAL REPLAY CONTROLS ─── */}\n      {showReplay \&\& (|" "$GLOBE"

            # The closing /> line shifted by 1 due to the insertion above
            NEW_CLOSE=$((COMPONENT_CLOSE + 1))
            # Add closing )} after the />
            sed -i "${NEW_CLOSE}a\\      )}" "$GLOBE"

            ok "Wrapped in {showReplay && (...)}"
        else
            fail "Could not find closing /> of TemporalReplayControls"
        fi
    else
        fail "Could not find TEMPORAL REPLAY CONTROLS comment"
    fi
fi
echo ""

# ─── 4. ADD TO ESCAPE HANDLER ────────────────────────────────────────────
echo "▸ STEP 4: Patch Escape handler"

if grep -q "setShowReplay(false)" "$GLOBE"; then
    ok "Already in Escape handler (skipping)"
else
    # Find an existing setShow in the Escape block and append
    if grep -q "setShowFlowMath(false)" "$GLOBE"; then
        sed -i "s|setShowFlowMath(false);|setShowFlowMath(false); setShowReplay(false);|" "$GLOBE"
        ok "Added to Escape handler"
    elif grep -q "setShowThreatIntel(false)" "$GLOBE"; then
        sed -i "s|setShowThreatIntel(false);|setShowThreatIntel(false); setShowReplay(false);|" "$GLOBE"
        ok "Added to Escape handler"
    elif grep -q "setShowInfrastructure(false)" "$GLOBE"; then
        sed -i "s|setShowInfrastructure(false);|setShowInfrastructure(false); setShowReplay(false);|" "$GLOBE"
        ok "Added to Escape handler"
    else
        info "Could not find Escape handler — Escape dismiss won't work for replay"
    fi
fi
echo ""

# ─── VALIDATE ─────────────────────────────────────────────────────────────
echo "▸ STEP 5: Validate"

ERRORS=0
grep -q "const \[showReplay" "$GLOBE"       || { echo -e "  ${RED}✗${NC} Missing state"; ERRORS=$((ERRORS+1)); }
grep -q "setShowReplay" "$GLOBE"             || { echo -e "  ${RED}✗${NC} Missing button"; ERRORS=$((ERRORS+1)); }
grep -q "showReplay &&" "$GLOBE"             || { echo -e "  ${RED}✗${NC} Missing conditional render"; ERRORS=$((ERRORS+1)); }
grep -q "setShowReplay(false)" "$GLOBE"      || { echo -e "  ${RED}✗${NC} Missing Escape handler"; ERRORS=$((ERRORS+1)); }

if [ "$ERRORS" -gt 0 ]; then
    fail "$ERRORS validation errors — check backup at $BACKUP_DIR"
fi
ok "All 4 patches validated"

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
echo "  Changes:"
echo "    • showReplay state hook added"
echo "    • ⏱ REPLAY button added to header (after PTI)"
echo "    • TemporalReplayControls now hidden until button clicked"
echo "    • Escape dismisses replay panel"
echo ""

read -p "  Build and deploy? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$HOME/cyber-weather/app"
    info "Building frontend..."
    docker compose build --no-cache frontend
    info "Deploying..."
    docker compose up -d frontend
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo -e "  ${GREEN}✅ DEPLOYED${NC}"
    echo ""
    echo "  ⏱ REPLAY button now in header bar"
    echo "  Click to show/hide temporal replay scrubber"
    echo "  Escape to dismiss"
    echo ""
    echo "  Rollback: cp $BACKUP_DIR/CyberWeatherGlobe.tsx.bak"
    echo "            frontend/src/components/CyberWeatherGlobe.tsx"
    echo "═══════════════════════════════════════════════════════════"
else
    echo "  Skipped. Build manually with:"
    echo "    docker compose build --no-cache frontend && docker compose up -d frontend"
fi
