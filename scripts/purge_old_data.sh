#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  purge_old_data.sh — Cyber Weather DB Retention Manager
#
#  Purges stale data to keep the Linode instance lean.
#  Run via cron: 0 3 * * * /home/deploy/cyber-weather/app/purge_old_data.sh >> /var/log/cyber-weather-purge.log 2>&1
#
#  Retention Policy:
#    events           →  7 days  (raw CTI feed data, biggest table)
#    nowcast          →  3 days  (refreshed every fitting cycle)
#    advisories       → 30 days  (trend analysis)
#    hawkes_params    → 30 days  (anomaly baseline)
#    forecast_snapshots → 14 days
#    forecast         →  7 days
# ═══════════════════════════════════════════════════════════

set -euo pipefail

PROJ="/home/deploy/cyber-weather/app"
COMPOSE="docker compose -f ${PROJ}/docker-compose.yml"
DB_USER="cyberweather"
DB_NAME="cyber_weather"
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

# ── Retention periods (days) ──────────────────────────────
EVENTS_DAYS=7
NOWCAST_DAYS=3
ADVISORY_DAYS=30
HAWKES_DAYS=30
SNAPSHOT_DAYS=14
FORECAST_DAYS=7

echo "═══════════════════════════════════════════════════"
echo "  Cyber Weather Purge — ${TIMESTAMP}"
echo "═══════════════════════════════════════════════════"

# Pre-purge sizes
echo ""
echo "── Pre-purge table sizes ─────────────────────────"
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "
SELECT
  relname AS table,
  n_live_tup AS rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
"

# ── Purge each table ─────────────────────────────────────
echo ""
echo "── Purging stale records ─────────────────────────"

# Events (biggest grower)
EVENTS_DEL=$($COMPOSE exec -T db psql -U $DB_USER $DB_NAME -t -c "
DELETE FROM events WHERE ts < NOW() - INTERVAL '${EVENTS_DAYS} days';
SELECT COUNT(*) FROM events;
" | tail -1 | tr -d ' ')
echo "  events:     kept ${EVENTS_DEL} rows (>${EVENTS_DAYS}d purged)"

# Nowcast
NOWCAST_DEL=$($COMPOSE exec -T db psql -U $DB_USER $DB_NAME -t -c "
DELETE FROM nowcast WHERE updated_at < NOW() - INTERVAL '${NOWCAST_DAYS} days';
SELECT COUNT(*) FROM nowcast;
" | tail -1 | tr -d ' ')
echo "  nowcast:    kept ${NOWCAST_DEL} rows (>${NOWCAST_DAYS}d purged)"

# Advisories
ADVISORY_DEL=$($COMPOSE exec -T db psql -U $DB_USER $DB_NAME -t -c "
DELETE FROM advisories WHERE issued_at < NOW() - INTERVAL '${ADVISORY_DAYS} days';
SELECT COUNT(*) FROM advisories;
" | tail -1 | tr -d ' ')
echo "  advisories: kept ${ADVISORY_DEL} rows (>${ADVISORY_DAYS}d purged)"

# Hawkes params
HAWKES_DEL=$($COMPOSE exec -T db psql -U $DB_USER $DB_NAME -t -c "
DELETE FROM hawkes_params WHERE updated_at < NOW() - INTERVAL '${HAWKES_DAYS} days';
SELECT COUNT(*) FROM hawkes_params;
" | tail -1 | tr -d ' ')
echo "  hawkes:     kept ${HAWKES_DEL} rows (>${HAWKES_DAYS}d purged)"

# Forecast snapshots
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "
DELETE FROM forecast_snapshots WHERE snapshot_at < NOW() - INTERVAL '${SNAPSHOT_DAYS} days';
" 2>/dev/null && echo "  snapshots:  >${SNAPSHOT_DAYS}d purged" || echo "  snapshots:  table not found (ok)"

# Forecast
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "
DELETE FROM forecast WHERE updated_at < NOW() - INTERVAL '${FORECAST_DAYS} days';
" 2>/dev/null && echo "  forecast:   >${FORECAST_DAYS}d purged" || echo "  forecast:   table not found (ok)"

# ── VACUUM ANALYZE ────────────────────────────────────────
echo ""
echo "── Reclaiming disk space (VACUUM ANALYZE) ────────"
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "VACUUM ANALYZE;"
echo "  ✓ VACUUM ANALYZE complete"

# ── Post-purge sizes ─────────────────────────────────────
echo ""
echo "── Post-purge table sizes ────────────────────────"
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "
SELECT
  relname AS table,
  n_live_tup AS rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
"

# ── DB total size ─────────────────────────────────────────
echo ""
echo "── Database total size ───────────────────────────"
$COMPOSE exec -T db psql -U $DB_USER $DB_NAME -c "
SELECT pg_size_pretty(pg_database_size('$DB_NAME')) AS total_db_size;
"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Purge complete — ${TIMESTAMP}"
echo "═══════════════════════════════════════════════════"
