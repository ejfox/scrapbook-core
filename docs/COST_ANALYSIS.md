# Cost Analysis Queries

All cost data is logged to `logs/cost-tracking.ndjson` as NDJSON (one JSON object per line).

## Quick Examples

### Total costs by task type
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.taskType) | map({taskType: .[0].taskType, totalCost: (map(.cost) | add), requests: length}) | sort_by(-.totalCost)'
```

### Total costs by model
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.modelId) | map({model: .[0].modelId, totalCost: (map(.cost) | add), requests: length, avgCost: ((map(.cost) | add) / length)}) | sort_by(-.totalCost)'
```

### Costs by hour of day (find expensive hours)
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.hour) | map({hour: .[0].hour, totalCost: (map(.cost) | add), requests: length}) | sort_by(.hour)'
```

### Most expensive scraps today
```bash
TODAY=$(date +%Y-%m-%d)
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s --arg date "$TODAY" 'map(select(.date == $date)) | group_by(.scrapId) | map({scrapId: .[0].scrapId, totalCost: (map(.cost) | add), tasks: (map(.taskType) | unique)}) | sort_by(-.totalCost) | .[0:10]'
```

### Cost breakdown by task type AND model
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.taskType) | map({taskType: .[0].taskType, byModel: (group_by(.modelId) | map({model: .[0].modelId, cost: (map(.cost) | add), requests: length}))}) '
```

### Find all OpenAI fallback usage (expensive!)
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq 'select(.source == "openai-fallback")'
```

### Average cost per task type
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.taskType) | map({taskType: .[0].taskType, avgCost: ((map(.cost) | add) / length), requests: length}) | sort_by(-.avgCost)'
```

### Costs in the last N hours
```bash
# Last 24 hours
grep "Cost tracked" logs/cost-tracking.ndjson | jq --arg since "$(date -u -v-24H +%Y-%m-%dT%H:%M:%S)" 'select(.timestamp > $since) | .cost' | jq -s 'add'
```

### Daily totals for last 7 days
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'group_by(.date) | map({date: .[0].date, totalCost: (map(.cost) | add), totalTokens: (map(.totalTokens) | add), requests: length, scraps: (map(select(.scrapId != null)) | length)}) | sort_by(-.date) | .[0:7]'
```

### Find thread discovery costs (new feature)
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'map(select(.taskType == "relevance-filter")) | {totalCost: (map(.cost) | add), requests: length, avgCost: ((map(.cost) | add) / length)}'
```

### Compare summarization costs (gemini vs OpenAI)
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'map(select(.taskType == "summarization")) | group_by(.modelId) | map({model: .[0].modelId, totalCost: (map(.cost) | add), avgCost: ((map(.cost) | add) / length), requests: length})'
```

### Find most expensive single requests
```bash
grep "Cost tracked" logs/cost-tracking.ndjson | jq -s 'sort_by(-.cost) | .[0:20] | map({cost: .cost, taskType, modelId, scrapId, timestamp})'
```

### Hourly cost rate for ongoing jobs
```bash
# Get costs from last hour
HOUR_AGO=$(date -u -v-1H +%Y-%m-%dT%H:%M:%S)
grep "Cost tracked" logs/cost-tracking.ndjson | jq --arg since "$HOUR_AGO" 'select(.timestamp > $since) | .cost' | jq -s 'add'
```

## Field Reference

Each NDJSON line contains:
- `timestamp`: ISO timestamp
- `date`: YYYY-MM-DD
- `hour`: HH (hour of day, 00-23)
- `modelId`: Model used (e.g., "gpt-4o-mini", "google/gemini-2.5-flash")
- `taskType`: What task (e.g., "summarization", "relevance-filter", "tag-extraction")
- `source`: Where it came from (e.g., "openai-fallback", "openrouter")
- `script`: Which script called it (if provided)
- `feature`: Which feature triggered it (if provided)
- `scrapId`: ID of scrap being processed (if applicable)
- `cost`: Total cost for this request
- `promptCost`: Cost of prompt tokens
- `completionCost`: Cost of completion tokens
- `promptTokens`: Number of prompt tokens
- `completionTokens`: Number of completion tokens
- `totalTokens`: Total tokens

## Live Monitoring

### Watch costs in real-time
```bash
tail -f logs/cost-tracking.ndjson | jq -c '{time: .timestamp, cost: .cost, task: .taskType, model: .modelId}'
```

### Running total
```bash
tail -f logs/cost-tracking.ndjson | jq -c '.cost' | awk '{sum+=$1; print "Total: $" sum}'
```
