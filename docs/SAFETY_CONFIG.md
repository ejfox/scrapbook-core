# Safety Configuration Environment Variables

The Safety Manager uses environment variables to configure protection thresholds. Set these in your `.env` file or environment to customize safety limits.

## Cost Protection

### Session Limits
```bash
# Maximum cost per processing session (default: $1.00)
SAFETY_SESSION_COST_LIMIT=1.0

# Maximum cost per day (default: $5.00)
SAFETY_DAILY_COST_LIMIT=5.0

# Maximum cost per individual scrap (default: $0.10)
SAFETY_SCRAP_COST_LIMIT=0.10
```

## Batch Size Limits

### Automated Run Limits (for cron jobs)
```bash
# Maximum items processed per automated run (default: 50)
SAFETY_MAX_ITEMS_PER_RUN=50

# Maximum items processed per hour (default: 200)
SAFETY_MAX_ITEMS_PER_HOUR=200

# Maximum items processed per day (default: 1000)
SAFETY_MAX_ITEMS_PER_DAY=1000
```

### Manual Run Limits (when user specifies --limit)
```bash
# Maximum items for manual runs (default: 500)
SAFETY_MANUAL_MAX_ITEMS_PER_RUN=500

# Maximum items per hour for manual runs (default: 2000)
SAFETY_MANUAL_MAX_ITEMS_PER_HOUR=2000

# Maximum items per day for manual runs (default: 5000)
SAFETY_MANUAL_MAX_ITEMS_PER_DAY=5000
```

## Error Rate Protection

### Consecutive Failure Protection
```bash
# Maximum consecutive failures before stopping (default: 5)
SAFETY_MAX_CONSECUTIVE_FAILURES=5

# Time window for failure rate calculation in ms (default: 300000 = 5 minutes)
SAFETY_ERROR_WINDOW_MS=300000

# Maximum failure rate before stopping (default: 0.5 = 50%)
SAFETY_MAX_FAILURE_RATE=0.5
```

### Data Validation
```bash
# Maximum malformed items before concern (default: 10)
SAFETY_MAX_MALFORMED_ITEMS=10
```

## System Resource Protection

### Memory Limits
```bash
# Maximum memory usage in MB before stopping (default: 1500)
SAFETY_MAX_MEMORY_MB=1500
```

## Recommended Settings

### Development Environment
```bash
# More permissive for testing
SAFETY_SESSION_COST_LIMIT=0.50
SAFETY_MAX_ITEMS_PER_RUN=20
SAFETY_MAX_CONSECUTIVE_FAILURES=3
SAFETY_MAX_MEMORY_MB=1000
```

### Production Environment (Conservative)
```bash
# Very conservative for unattended operation
SAFETY_SESSION_COST_LIMIT=0.50
SAFETY_DAILY_COST_LIMIT=2.00
SAFETY_MAX_ITEMS_PER_RUN=25
SAFETY_MAX_ITEMS_PER_HOUR=100
SAFETY_MAX_ITEMS_PER_DAY=500
SAFETY_MAX_CONSECUTIVE_FAILURES=3
SAFETY_MAX_MEMORY_MB=1200
```

### Production Environment (Standard)
```bash
# Balanced settings for regular operation
SAFETY_SESSION_COST_LIMIT=1.00
SAFETY_DAILY_COST_LIMIT=5.00
SAFETY_MAX_ITEMS_PER_RUN=50
SAFETY_MAX_ITEMS_PER_HOUR=200
SAFETY_MAX_ITEMS_PER_DAY=1000
SAFETY_MAX_CONSECUTIVE_FAILURES=5
SAFETY_MAX_MEMORY_MB=1500
```

## Safety Manager CLI Commands

### Check Current Status
```bash
# View current safety status
node tests/test_safety.mjs --status
```

### Reset Safety States
```bash
# Reset cost circuit breaker
node tests/test_safety.mjs --reset-cost

# Reset error tracking
node tests/test_safety.mjs --reset-errors

# Reset all safety states
node tests/test_safety.mjs --reset-all
```

### Test Safety Mechanisms
```bash
# Simulate cost limit breach
node tests/test_safety.mjs --test-cost

# Simulate consecutive failures
node tests/test_safety.mjs --test-failures

# Simulate memory pressure
node tests/test_safety.mjs --test-memory
```

## Safety Logs

Safety events are logged to:
- `logs/safety-manager.log` - Detailed safety events
- `logs/combined.log` - General application logs with safety events
- Console output with colored indicators

## Monitoring

The safety manager automatically:
- ✅ Tracks processing counts and costs in real-time
- ⚠️ Warns when approaching limits (80% of cost thresholds)
- 🚨 Stops processing when limits are exceeded
- 💾 Persists safety state across restarts
- 📊 Provides detailed status reporting

## Integration with Existing Systems

The safety manager integrates with:
- **Cost Tracking**: Uses existing cost calculation but adds circuit breaker
- **Error Handling**: Enhances existing error logging with safety tracking
- **Rate Limiting**: Works alongside existing Bottleneck rate limiters
- **Logging**: Adds safety-specific log entries to existing winston setup
- **Webhooks**: Can trigger alerts through existing webhook system
