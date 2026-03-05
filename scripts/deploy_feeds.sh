#!/bin/bash
# ============================================================
#  Deploy OTX + AbuseIPDB feeds to cyber-weather
#  Run from: ~/cyber-weather/app/
# ============================================================
set -e

APP_DIR="${HOME}/cyber-weather/app"
INGEST_DIR="${APP_DIR}/backend/app/ingest"
CONFIG_FILE="${APP_DIR}/backend/app/core/config.py"
PIPELINE_FILE="${APP_DIR}/backend/app/services/pipeline.py"

echo "============================================================"
echo "  Deploying OTX + AbuseIPDB feeds"
echo "============================================================"

# ---- Step 1: Copy new ingest modules ----
echo ""
echo "[1/5] Copying ingest modules..."

# These files should already be in the current directory
# after SCP from local machine
for f in otx.py abuseipdb.py country_centroids.py; do
    if [ -f "${APP_DIR}/${f}" ]; then
        cp "${APP_DIR}/${f}" "${INGEST_DIR}/${f}"
        echo "  ✓ ${f} → ${INGEST_DIR}/"
    elif [ -f "${f}" ]; then
        cp "${f}" "${INGEST_DIR}/${f}"
        echo "  ✓ ${f} → ${INGEST_DIR}/"
    else
        echo "  ✗ ${f} not found — create it first"
        exit 1
    fi
done

# ---- Step 2: Add config settings ----
echo ""
echo "[2/5] Adding API key settings to config..."

# Check if OTX key already exists in config
if grep -q "otx_api_key" "${CONFIG_FILE}"; then
    echo "  ⊘ OTX config already exists"
else
    # Add after the last existing API key setting
    # Find the line with the last known API key setting
    LAST_KEY_LINE=$(grep -n "api_key\|auth_key\|db_path" "${CONFIG_FILE}" | tail -1 | cut -d: -f1)
    if [ -n "${LAST_KEY_LINE}" ]; then
        sed -i "${LAST_KEY_LINE}a\\
    otx_api_key: str = \"\"  # AlienVault OTX API key\\
    abuseipdb_api_key: str = \"\"  # AbuseIPDB API key" "${CONFIG_FILE}"
        echo "  ✓ Added otx_api_key and abuseipdb_api_key to config"
    else
        echo "  ⚠ Could not find insertion point in config — add manually:"
        echo "    otx_api_key: str = \"\""
        echo "    abuseipdb_api_key: str = \"\""
    fi
fi

# ---- Step 3: Add env vars to .env ----
echo ""
echo "[3/5] Updating .env file..."

ENV_FILE="${APP_DIR}/backend/.env"
if [ ! -f "${ENV_FILE}" ]; then
    ENV_FILE="${APP_DIR}/.env"
fi

if [ -f "${ENV_FILE}" ]; then
    if ! grep -q "OTX_API_KEY" "${ENV_FILE}"; then
        echo "" >> "${ENV_FILE}"
        echo "# AlienVault OTX — get key at https://otx.alienvault.com/api" >> "${ENV_FILE}"
        echo "CYBER_WEATHER_OTX_API_KEY=" >> "${ENV_FILE}"
        echo "  ✓ Added OTX_API_KEY placeholder to .env"
    else
        echo "  ⊘ OTX_API_KEY already in .env"
    fi

    if ! grep -q "ABUSEIPDB_API_KEY" "${ENV_FILE}"; then
        echo "" >> "${ENV_FILE}"
        echo "# AbuseIPDB — get key at https://www.abuseipdb.com/account/api" >> "${ENV_FILE}"
        echo "CYBER_WEATHER_ABUSEIPDB_API_KEY=" >> "${ENV_FILE}"
        echo "  ✓ Added ABUSEIPDB_API_KEY placeholder to .env"
    else
        echo "  ⊘ ABUSEIPDB_API_KEY already in .env"
    fi
else
    echo "  ⚠ No .env file found at ${ENV_FILE}"
    echo "    Create one with:"
    echo "    CYBER_WEATHER_OTX_API_KEY=your_key_here"
    echo "    CYBER_WEATHER_ABUSEIPDB_API_KEY=your_key_here"
fi

# ---- Step 4: Wire into pipeline ----
echo ""
echo "[4/5] Wiring feeds into pipeline..."

# Add imports to pipeline.py
if grep -q "from.*ingest.*otx" "${PIPELINE_FILE}" 2>/dev/null; then
    echo "  ⊘ OTX already imported in pipeline"
else
    # Find the last ingest import line
    LAST_IMPORT=$(grep -n "from.*ingest" "${PIPELINE_FILE}" | tail -1 | cut -d: -f1)
    if [ -n "${LAST_IMPORT}" ]; then
        sed -i "${LAST_IMPORT}a\\
from ..ingest import otx\\
from ..ingest import abuseipdb" "${PIPELINE_FILE}"
        echo "  ✓ Added OTX + AbuseIPDB imports to pipeline"
    else
        echo "  ⚠ Could not find import insertion point"
    fi
fi

# Add to run_ingest_cycle's asyncio.gather or sequential calls
# We need to find where dshield.ingest is called and add our new feeds
if grep -q "otx.ingest" "${PIPELINE_FILE}" 2>/dev/null; then
    echo "  ⊘ OTX already wired into ingest cycle"
else
    echo ""
    echo "  ⚠ MANUAL STEP NEEDED: Add to run_ingest_cycle() in pipeline.py"
    echo "    Find where dshield.ingest / abusech.ingest are called and add:"
    echo ""
    echo '    # OTX pulse indicators'
    echo '    try:'
    echo '        otx_count = await otx.ingest(session, hours_back=24)'
    echo '        results["otx"] = {"status": "success", "events": otx_count}'
    echo '    except Exception as e:'
    echo '        logger.error(f"OTX ingest failed: {e}")'
    echo '        results["otx"] = {"status": "error", "error": str(e)}'
    echo ''
    echo '    # AbuseIPDB blacklist + enrichment'
    echo '    try:'
    echo '        abuseipdb_count = await abuseipdb.ingest(session, hours_back=24)'
    echo '        results["abuseipdb"] = {"status": "success", "events": abuseipdb_count}'
    echo '    except Exception as e:'
    echo '        logger.error(f"AbuseIPDB ingest failed: {e}")'
    echo '        results["abuseipdb"] = {"status": "error", "error": str(e)}'
    echo ""
fi

# ---- Step 5: Verify ----
echo ""
echo "[5/5] Verification..."

echo "  Checking ingest directory:"
ls -la "${INGEST_DIR}/"*.py 2>/dev/null | awk '{print "    " $NF}'

echo ""
echo "  Checking imports:"
python3 -c "
import ast, sys
for f in ['otx.py', 'abuseipdb.py', 'country_centroids.py']:
    try:
        with open('${INGEST_DIR}/' + f) as fh:
            ast.parse(fh.read())
        print(f'    ✓ {f} — syntax OK')
    except SyntaxError as e:
        print(f'    ✗ {f} — syntax error: {e}')
        sys.exit(1)
"

echo ""
echo "============================================================"
echo "  NEXT STEPS"
echo "============================================================"
echo ""
echo "  1. Get API keys:"
echo "     OTX:       https://otx.alienvault.com/api"
echo "     AbuseIPDB: https://www.abuseipdb.com/account/api"
echo ""
echo "  2. Add keys to .env:"
echo "     CYBER_WEATHER_OTX_API_KEY=your_otx_key"
echo "     CYBER_WEATHER_ABUSEIPDB_API_KEY=your_abuseipdb_key"
echo ""
echo "  3. Wire into pipeline.py (see manual step above)"
echo ""
echo "  4. Rebuild and test:"
echo "     docker compose build --no-cache backend"
echo "     docker compose up -d backend"
echo "     sleep 20"
echo ""
echo "  5. Test each feed individually:"
echo '     docker compose exec backend python -c "'
echo '     from app.ingest import otx'
echo '     from app.core.database import get_session'
echo '     import asyncio'
echo '     session = next(get_session())'
echo '     count = asyncio.run(otx.ingest(session, hours_back=48))'
echo '     print(f\"OTX: {count} events\")'
echo '     "'
echo ""
echo '     docker compose exec backend python -c "'
echo '     from app.ingest import abuseipdb'
echo '     from app.core.database import get_session'
echo '     import asyncio'
echo '     session = next(get_session())'
echo '     count = asyncio.run(abuseipdb.ingest(session, hours_back=24))'
echo '     print(f\"AbuseIPDB: {count} events\")'
echo '     "'
echo ""
echo "============================================================"
