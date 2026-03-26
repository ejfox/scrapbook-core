#!/bin/bash
# OpenRouter Usage Metrics
# Fetches usage from OpenRouter API and pushes to Loki + writes Prometheus metrics
# Run via cron: */15 * * * * /path/to/openrouter-metrics.sh

set -e

# Config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
METRICS_FILE="/tmp/openrouter_metrics.prom"
LOKI_URL="${LOKI_URL:-http://localhost:3100/loki/api/v1/push}"

# Load API key from .env
if [ -f "$ENV_FILE" ]; then
    OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' "$ENV_FILE" | cut -d'=' -f2)
fi

if [ -z "$OPENROUTER_API_KEY" ]; then
    echo "Error: OPENROUTER_API_KEY not found"
    exit 1
fi

# Fetch usage from OpenRouter
RESPONSE=$(curl -s "https://openrouter.ai/api/v1/key" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY")

# Parse values
USAGE_TOTAL=$(echo "$RESPONSE" | jq -r '.data.usage // 0')
USAGE_DAILY=$(echo "$RESPONSE" | jq -r '.data.usage_daily // 0')
USAGE_WEEKLY=$(echo "$RESPONSE" | jq -r '.data.usage_weekly // 0')
USAGE_MONTHLY=$(echo "$RESPONSE" | jq -r '.data.usage_monthly // 0')
IS_FREE_TIER=$(echo "$RESPONSE" | jq -r '.data.is_free_tier // false')

TIMESTAMP=$(date +%s)
TIMESTAMP_NS="${TIMESTAMP}000000000"
ISO_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Write Prometheus metrics
cat > "$METRICS_FILE" << EOF
# HELP openrouter_usage_dollars_total Total OpenRouter usage in USD
# TYPE openrouter_usage_dollars_total gauge
openrouter_usage_dollars_total $USAGE_TOTAL

# HELP openrouter_usage_daily_dollars Today's OpenRouter usage in USD
# TYPE openrouter_usage_daily_dollars gauge
openrouter_usage_daily_dollars $USAGE_DAILY

# HELP openrouter_usage_weekly_dollars This week's OpenRouter usage in USD
# TYPE openrouter_usage_weekly_dollars gauge
openrouter_usage_weekly_dollars $USAGE_WEEKLY

# HELP openrouter_usage_monthly_dollars This month's OpenRouter usage in USD
# TYPE openrouter_usage_monthly_dollars gauge
openrouter_usage_monthly_dollars $USAGE_MONTHLY

# HELP openrouter_scrape_timestamp_seconds Unix timestamp of last successful scrape
# TYPE openrouter_scrape_timestamp_seconds gauge
openrouter_scrape_timestamp_seconds $TIMESTAMP
EOF

echo "Prometheus metrics written to $METRICS_FILE"

# Push to Loki
LOKI_PAYLOAD=$(cat << EOF
{
  "streams": [
    {
      "stream": {
        "job": "openrouter",
        "source": "api",
        "type": "usage"
      },
      "values": [
        ["$TIMESTAMP_NS", "{\"total\": $USAGE_TOTAL, \"daily\": $USAGE_DAILY, \"weekly\": $USAGE_WEEKLY, \"monthly\": $USAGE_MONTHLY, \"timestamp\": \"$ISO_TIME\"}"]
      ]
    }
  ]
}
EOF
)

if curl -s -X POST "$LOKI_URL" \
    -H "Content-Type: application/json" \
    -d "$LOKI_PAYLOAD" > /dev/null 2>&1; then
    echo "Pushed to Loki: daily=\$$USAGE_DAILY weekly=\$$USAGE_WEEKLY monthly=\$$USAGE_MONTHLY"
else
    echo "Warning: Failed to push to Loki (may not be available locally)"
fi

# Output summary
echo "OpenRouter Usage: daily=\$$USAGE_DAILY | weekly=\$$USAGE_WEEKLY | monthly=\$$USAGE_MONTHLY | total=\$$USAGE_TOTAL"
