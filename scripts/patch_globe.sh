#!/bin/bash
# ============================================================
#  Patch globe rendering for worldwide coverage
#  Run from: ~/cyber-weather/app/
# ============================================================
set -e

GLOBE_FILE="frontend/src/components/CyberWeatherGlobe.tsx"

echo "============================================================"
echo "  Patching globe for worldwide threat visibility"
echo "============================================================"

# 1. Increase arc limit from 8 to 25
if grep -q "hotspots.slice(0, Math.min(hotspots.length, 8))" "${GLOBE_FILE}"; then
    sed -i 's/hotspots.slice(0, Math.min(hotspots.length, 8))/hotspots.slice(0, Math.min(hotspots.length, 25))/' "${GLOBE_FILE}"
    echo "  ✓ Arc limit: 8 → 25"
else
    echo "  ⊘ Arc limit already modified (or pattern changed)"
fi

# 2. Add more diverse arc routing — connect distant regions
# Instead of only connecting nearby hotspots, connect across hemispheres
# This is handled by the arc pair generation logic

# 3. Lower minimum dot size so low-intensity regions show
# Make sure even intensity=0.1 produces a visible dot
if grep -q "0.008 \* (0.5 + Math.log1p" "${GLOBE_FILE}"; then
    sed -i 's/0.008 \* (0.5 + Math.log1p(spot.intensity) \* 0.3)/0.006 * (0.8 + Math.log1p(spot.intensity) * 0.4)/' "${GLOBE_FILE}"
    echo "  ✓ Dot sizing: increased minimum visibility"
elif grep -q "0.012 \* (0.5 + Math.min" "${GLOBE_FILE}"; then
    sed -i 's/0.012 \* (0.5 + Math.min(spot.intensity, 5))/0.006 * (0.8 + Math.log1p(spot.intensity) * 0.4)/' "${GLOBE_FILE}"
    echo "  ✓ Dot sizing: switched to log scale with higher minimum"
else
    echo "  ⊘ Dot sizing pattern not found — check manually"
fi

echo ""
echo "  Done. Rebuild frontend:"
echo "    docker compose build --no-cache frontend"
echo "    docker compose up -d frontend"
echo "============================================================"
