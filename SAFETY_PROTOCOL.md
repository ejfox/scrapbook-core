# 🛡️ SCRAPBOOK SAFETY PROTOCOL

**NEVER add credits to OpenRouter or run processing without following this protocol.**

This document was created after wasting $47 on broken AI services that weren't saving data. Never again.

## The Problem We Had

- Spent $47 on AI processing
- Only 7.5% of scraps got summaries (716 out of 9,517)
- 0% got embeddings
- Money went to OpenAI embeddings while OpenRouter summarization silently failed
- No alerts, no warnings, just wasted money

## The Solution: Multi-Layer Safety System

### Layer 1: Pre-Flight Health Check

**RUN THIS BEFORE ADDING ANY CREDITS**

```bash
npm run health
```

This checks:
- ✅ All API keys are configured correctly
- ✅ OpenRouter has credits and is working
- ✅ OpenAI API is accessible
- ✅ Database connection and permissions
- ✅ AI summarization actually works (costs ~$0.001)
- ✅ Embeddings actually work (costs ~$0.0001)
- ✅ End-to-end test: generate → save → verify (costs ~$0.005)

**Total cost: ~$0.01**

**Exit codes:**
- `0` = HEALTHY - safe to process
- `1` = CRITICAL - DO NOT PROCESS

### Layer 2: Circuit Breakers

Automatically stops processing if services are failing:

- **Summarization**: Stops after 3 consecutive failures
- **Embeddings**: Stops after 3 consecutive failures
- **Relationships**: Stops after 5 consecutive failures (less critical)
- **Screenshots**: Stops after 5 consecutive failures (less critical)

When a circuit trips:
- Processing stops immediately
- 2-minute cooldown period
- Attempts to recover automatically
- Loud error logging

Check circuit breaker status:
```bash
grep "CircuitBreaker" logs/combined.log | tail -20
```

### Layer 3: Post-Processing Validation

**RUN THIS AFTER PROCESSING**

```bash
npm run validate          # Check last 60 minutes
npm run validate 120      # Check last 2 hours
```

This verifies:
- ✅ Scraps actually have summaries
- ✅ Scraps actually have embeddings
- ✅ Success rate meets threshold (70% minimum)
- ✅ Money wasn't wasted on failed operations

Shows:
- Field completeness percentages
- Examples of failed scraps
- Cost per scrap
- Clear PASS/FAIL verdict

### Layer 4: Field Completeness Audit

Check overall database health:

```bash
npm run audit
```

Shows completeness for:
- Summaries
- Tags
- Relationships
- Locations
- Financial analysis
- Screenshots
- Embeddings

## The Safe Processing Workflow

### BEFORE Adding Credits:

1. **Run Health Check**
   ```bash
   npm run health
   ```
   - ❌ If it fails: FIX ISSUES FIRST
   - ✅ If it passes: Continue

2. **Review Current State**
   ```bash
   npm run audit
   ```
   - See what's missing
   - Estimate costs

### AFTER Adding Credits:

3. **Small Test Run**
   ```bash
   node scripts/index.mjs --pinboard --limit 5
   ```
   - Process just 5 scraps
   - Cost: ~$0.01-0.05
   - Watch for errors

4. **Validate Test Run**
   ```bash
   npm run validate 5
   ```
   - ❌ If validation fails: STOP AND INVESTIGATE
   - ✅ If validation passes: Continue

5. **Larger Batch**
   ```bash
   node scripts/index.mjs --pinboard --limit 50
   ```
   - Cost: ~$0.10-0.50
   - Monitor circuit breakers

6. **Validate Batch**
   ```bash
   npm run validate 30
   ```
   - ❌ If validation fails: STOP
   - ✅ If validation passes: Scale up

7. **Full Processing**
   ```bash
   npm run fetch:all
   ```
   - Only after small batches succeed
   - Monitor logs: `tail -f logs/combined.log`

### Daily Monitoring:

```bash
# Morning check
npm run audit

# After processing
npm run validate

# Check costs
cat data/cost-history.json | jq '.dailyStats["2025-10-25"]'
```

## Red Flags to Watch For

🚨 **STOP IMMEDIATELY IF:**

1. **Health check fails**
   - Fix the issue before proceeding

2. **Validation shows <70% success rate**
   - Something is broken
   - You're wasting money

3. **Circuit breaker trips repeatedly**
   - Check logs
   - Services are failing

4. **No summaries being saved**
   ```bash
   npm run audit
   ```
   - If summary % stays at 0%, STOP

5. **Cost per scrap >$0.01**
   - Something is inefficient
   - Check cost-history.json

6. **Free model fallbacks happening**
   - Check logs for "Payment required"
   - OpenRouter is out of credits

## Cost Monitoring

### Check Today's Spending:
```bash
cat data/cost-history.json | jq '.dailyStats | to_entries | last'
```

### Check Cost Per Scrap:
```bash
node -e "
const data = require('./data/cost-history.json');
const today = Object.entries(data.dailyStats).pop()[1];
console.log('Cost per scrap:', (today.cost / today.scrapCount).toFixed(4));
"
```

### Expected Costs:
- **Per scrap (full processing):**
  - Summary: ~$0.0005
  - Embedding: ~$0.0002
  - Relationships: ~$0.0003
  - **Total: ~$0.001 per scrap**

- **Daily (500 scraps):** ~$0.50
- **Weekly (3,500 scraps):** ~$3.50
- **Monthly (15,000 scraps):** ~$15

## Safety Limits

Currently configured in `data/safety-state.json`:

```json
{
  "costBreaker": {
    "sessionLimit": 1,      // Max $1 per run
    "dailyLimit": 5,        // Max $5 per day
    "scrapLimit": 0.1       // Max $0.10 per scrap
  },
  "batchLimits": {
    "automated": {
      "maxItemsPerRun": 50,
      "maxItemsPerHour": 200,
      "maxItemsPerDay": 1000
    }
  }
}
```

## Emergency Procedures

### If Processing Goes Wrong:

1. **Kill the process**
   ```bash
   pkill -f "node scripts/index.mjs"
   ```

2. **Check what happened**
   ```bash
   npm run validate
   tail -100 logs/error.log
   ```

3. **Review costs**
   ```bash
   npm run audit
   cat data/cost-history.json | jq '.dailyStats | to_entries | last'
   ```

4. **Run health check**
   ```bash
   npm run health
   ```

5. **Fix issues before resuming**

### If You Suspect Money is Being Wasted:

1. **Stop all processing immediately**
2. **Run validation:** `npm run validate 120`
3. **Run audit:** `npm run audit`
4. **Check logs:** `tail -200 logs/error.log`
5. **Run health check:** `npm run health`
6. **Do NOT add more credits until issues are fixed**

## Testing After Fixes

After fixing any issues:

```bash
# 1. Health check
npm run health

# 2. Small test (1 scrap)
node scripts/index.mjs --pinboard --limit 1

# 3. Validate
npm run validate 5

# 4. Check the actual scrap
node check_actual_data.mjs

# 5. If all good, scale up slowly
```

## Questions Before Adding Credits

Ask yourself:

- [ ] Did I run `npm run health` successfully?
- [ ] Did I test with `--limit 5` first?
- [ ] Did I validate the test run?
- [ ] Are summaries actually being saved?
- [ ] Are embeddings being generated?
- [ ] Is the success rate >70%?
- [ ] Is cost per scrap <$0.01?
- [ ] Have I reviewed the logs for errors?

**If ANY answer is NO → DO NOT ADD CREDITS**

## Remember

> "Trust, but verify. Every single time."

The system will fail silently if we let it. These safety checks prevent:
- Wasted money
- Silent failures
- Data loss
- Broken pipelines going unnoticed

**Use them. Every time.**
