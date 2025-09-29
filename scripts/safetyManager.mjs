/**
 * Safety Manager for Scrapbook Core
 * Provides comprehensive safety mechanisms to prevent runaway costs,
 * batch size overruns, and system failures in automated operations
 */

import fs from 'fs';
import path from 'path';
import winston from 'winston';
import chalk from 'chalk';
import { getSessionStats, checkCostAlerts } from './costTracking.mjs';

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/safety-manager.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Safety state tracking
let safetyState = {
  // Cost circuit breaker
  costBreaker: {
    tripped: false,
    sessionLimit: parseFloat(process.env.SAFETY_SESSION_COST_LIMIT || '1.0'),
    dailyLimit: parseFloat(process.env.SAFETY_DAILY_COST_LIMIT || '5.0'),
    scrapLimit: parseFloat(process.env.SAFETY_SCRAP_COST_LIMIT || '0.10')
  },

  // Error rate protection
  errorTracker: {
    consecutiveFailures: 0,
    maxConsecutiveFailures: parseInt(process.env.SAFETY_MAX_CONSECUTIVE_FAILURES || '5'),
    totalFailures: 0,
    totalAttempts: 0,
    windowStart: Date.now(),
    windowSize: parseInt(process.env.SAFETY_ERROR_WINDOW_MS || '300000'), // 5 minutes
    maxFailureRate: parseFloat(process.env.SAFETY_MAX_FAILURE_RATE || '0.5') // 50%
  },

  // Batch size limits
  batchLimits: {
    automated: {
      maxItemsPerRun: parseInt(process.env.SAFETY_MAX_ITEMS_PER_RUN || '50'),
      maxItemsPerHour: parseInt(process.env.SAFETY_MAX_ITEMS_PER_HOUR || '200'),
      maxItemsPerDay: parseInt(process.env.SAFETY_MAX_ITEMS_PER_DAY || '1000')
    },
    manual: {
      maxItemsPerRun: parseInt(process.env.SAFETY_MANUAL_MAX_ITEMS_PER_RUN || '500'),
      maxItemsPerHour: parseInt(process.env.SAFETY_MANUAL_MAX_ITEMS_PER_HOUR || '2000'),
      maxItemsPerDay: parseInt(process.env.SAFETY_MANUAL_MAX_ITEMS_PER_DAY || '5000')
    }
  },

  // Processing state
  processing: {
    isAutomated: false,
    runStartTime: null,
    itemsProcessedThisRun: 0,
    itemsProcessedThisHour: 0,
    itemsProcessedThisDay: 0,
    lastHourReset: Date.now(),
    lastDayReset: Date.now()
  },

  // Data validation
  validation: {
    skipCorruptData: true,
    maxMalformedItems: parseInt(process.env.SAFETY_MAX_MALFORMED_ITEMS || '10')
  }
};

// Load safety state from disk on startup
function loadSafetyState() {
  const safetyFile = path.join(process.cwd(), 'data', 'safety-state.json');
  try {
    if (fs.existsSync(safetyFile)) {
      const data = JSON.parse(fs.readFileSync(safetyFile, 'utf8'));

      // Reset daily/hourly counters if needed
      const now = Date.now();
      if (now - data.processing.lastDayReset > 24 * 60 * 60 * 1000) {
        data.processing.itemsProcessedThisDay = 0;
        data.processing.itemsProcessedThisHour = 0;
        data.processing.lastDayReset = now;
        data.processing.lastHourReset = now;
      } else if (now - data.processing.lastHourReset > 60 * 60 * 1000) {
        data.processing.itemsProcessedThisHour = 0;
        data.processing.lastHourReset = now;
      }

      // Merge with defaults, preserving counters
      safetyState.processing = { ...safetyState.processing, ...data.processing };
      safetyState.errorTracker = { ...safetyState.errorTracker, ...data.errorTracker };

      logger.info('Safety state loaded', {
        itemsToday: safetyState.processing.itemsProcessedThisDay,
        itemsThisHour: safetyState.processing.itemsProcessedThisHour,
        consecutiveFailures: safetyState.errorTracker.consecutiveFailures
      });
    }
  } catch (error) {
    logger.warn('Could not load safety state:', error.message);
  }
}

// Save safety state to disk
function saveSafetyState() {
  const safetyFile = path.join(process.cwd(), 'data', 'safety-state.json');
  const dataDir = path.dirname(safetyFile);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  try {
    fs.writeFileSync(safetyFile, JSON.stringify(safetyState, null, 2));
  } catch (error) {
    logger.error('Could not save safety state:', error.message);
  }
}

/**
 * Initialize safety manager
 */
export function initializeSafetyManager() {
  loadSafetyState();

  // Save state periodically
  setInterval(saveSafetyState, 30000); // Every 30 seconds

  // Save on shutdown
  process.on('SIGINT', saveSafetyState);
  process.on('SIGTERM', saveSafetyState);

  logger.info('Safety Manager initialized', {
    sessionCostLimit: safetyState.costBreaker.sessionLimit,
    maxConsecutiveFailures: safetyState.errorTracker.maxConsecutiveFailures,
    maxItemsPerRun: safetyState.batchLimits.automated.maxItemsPerRun
  });
}

/**
 * Check if processing should continue based on all safety conditions
 */
export function shouldContinueProcessing(isAutomated = true) {
  safetyState.processing.isAutomated = isAutomated;

  const checks = [
    checkCostLimits,
    checkBatchLimits,
    checkErrorRates,
    checkSystemResources
  ];

  for (const check of checks) {
    const result = check();
    if (!result.safe) {
      logger.error('Safety check failed', {
        check: check.name,
        reason: result.reason,
        isAutomated,
        action: 'STOPPING_PROCESSING'
      });

      console.log(chalk.red(`🚨 SAFETY STOP: ${result.reason}`));
      console.log(chalk.yellow(`   Check: ${check.name}`));
      console.log(chalk.gray(`   Mode: ${isAutomated ? 'Automated' : 'Manual'}`));

      return {
        safe: false,
        reason: result.reason,
        check: check.name,
        recommendation: result.recommendation || 'Wait before retrying'
      };
    }
  }

  return { safe: true };
}

/**
 * Check cost-based circuit breaker
 */
function checkCostLimits() {
  const sessionStats = getSessionStats();
  const costAlerts = checkCostAlerts({
    sessionCostLimit: safetyState.costBreaker.sessionLimit,
    dailyCostLimit: safetyState.costBreaker.dailyLimit,
    scrapCostLimit: safetyState.costBreaker.scrapLimit
  });

  // If we already tripped the cost breaker, stay stopped
  if (safetyState.costBreaker.tripped) {
    return {
      safe: false,
      reason: `Cost circuit breaker already tripped (session: $${sessionStats.totalCost.toFixed(4)})`,
      recommendation: 'Reset session or increase limits'
    };
  }

  // Check for cost limit violations
  if (costAlerts.length > 0) {
    safetyState.costBreaker.tripped = true;
    const primaryAlert = costAlerts[0];

    return {
      safe: false,
      reason: `Cost limit exceeded: ${primaryAlert.message}`,
      recommendation: costAlerts.length > 1 ? `${costAlerts.length} total violations` : 'Increase cost limits or wait'
    };
  }

  return { safe: true };
}

/**
 * Check batch size limits
 */
function checkBatchLimits() {
  const limits = safetyState.processing.isAutomated
    ? safetyState.batchLimits.automated
    : safetyState.batchLimits.manual;

  const { itemsProcessedThisRun, itemsProcessedThisHour, itemsProcessedThisDay } = safetyState.processing;

  if (itemsProcessedThisRun >= limits.maxItemsPerRun) {
    return {
      safe: false,
      reason: `Run batch limit reached: ${itemsProcessedThisRun}/${limits.maxItemsPerRun}`,
      recommendation: 'Complete current run and start new session'
    };
  }

  if (itemsProcessedThisHour >= limits.maxItemsPerHour) {
    return {
      safe: false,
      reason: `Hourly limit reached: ${itemsProcessedThisHour}/${limits.maxItemsPerHour}`,
      recommendation: 'Wait until next hour'
    };
  }

  if (itemsProcessedThisDay >= limits.maxItemsPerDay) {
    return {
      safe: false,
      reason: `Daily limit reached: ${itemsProcessedThisDay}/${limits.maxItemsPerDay}`,
      recommendation: 'Wait until tomorrow'
    };
  }

  return { safe: true };
}

/**
 * Check error rates and consecutive failures
 */
function checkErrorRates() {
  const { consecutiveFailures, maxConsecutiveFailures, totalFailures, totalAttempts, maxFailureRate } = safetyState.errorTracker;

  // Check consecutive failures
  if (consecutiveFailures >= maxConsecutiveFailures) {
    return {
      safe: false,
      reason: `Too many consecutive failures: ${consecutiveFailures}/${maxConsecutiveFailures}`,
      recommendation: 'Investigate recurring issues before continuing'
    };
  }

  // Check overall failure rate in current window
  if (totalAttempts > 10) { // Only check rate after reasonable sample size
    const failureRate = totalFailures / totalAttempts;
    if (failureRate > maxFailureRate) {
      return {
        safe: false,
        reason: `High failure rate: ${(failureRate * 100).toFixed(1)}% (${totalFailures}/${totalAttempts})`,
        recommendation: 'System may be degraded - investigate before continuing'
      };
    }
  }

  return { safe: true };
}

/**
 * Check system resources
 */
function checkSystemResources() {
  const memoryUsage = process.memoryUsage();
  const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
  const maxMemoryMB = parseInt(process.env.SAFETY_MAX_MEMORY_MB || '1500');

  if (memoryMB > maxMemoryMB) {
    return {
      safe: false,
      reason: `Memory usage too high: ${memoryMB.toFixed(0)}MB > ${maxMemoryMB}MB`,
      recommendation: 'Restart process or reduce batch size'
    };
  }

  return { safe: true };
}

/**
 * Start a new processing run
 */
export function startProcessingRun(options = {}) {
  const { isAutomated = true, expectedItems = 0 } = options;

  safetyState.processing.isAutomated = isAutomated;
  safetyState.processing.runStartTime = Date.now();
  safetyState.processing.itemsProcessedThisRun = 0;

  const limits = isAutomated ? safetyState.batchLimits.automated : safetyState.batchLimits.manual;

  logger.info('Processing run started', {
    isAutomated,
    expectedItems,
    maxItemsPerRun: limits.maxItemsPerRun,
    itemsRemainingToday: limits.maxItemsPerDay - safetyState.processing.itemsProcessedThisDay,
    itemsRemainingThisHour: limits.maxItemsPerHour - safetyState.processing.itemsProcessedThisHour
  });

  console.log(chalk.blue(`🚀 Starting ${isAutomated ? 'automated' : 'manual'} processing run`));
  console.log(chalk.gray(`   Expected items: ${expectedItems}`));
  console.log(chalk.gray(`   Max per run: ${limits.maxItemsPerRun}`));
  console.log(chalk.gray(`   Remaining today: ${limits.maxItemsPerDay - safetyState.processing.itemsProcessedThisDay}`));
}

/**
 * Record successful processing of an item
 */
export function recordSuccess(itemId, source) {
  safetyState.processing.itemsProcessedThisRun += 1;
  safetyState.processing.itemsProcessedThisHour += 1;
  safetyState.processing.itemsProcessedThisDay += 1;

  // Reset consecutive failures on success
  safetyState.errorTracker.consecutiveFailures = 0;
  safetyState.errorTracker.totalAttempts += 1;

  // Reset error window if needed
  const now = Date.now();
  if (now - safetyState.errorTracker.windowStart > safetyState.errorTracker.windowSize) {
    safetyState.errorTracker.totalFailures = 0;
    safetyState.errorTracker.totalAttempts = 0;
    safetyState.errorTracker.windowStart = now;
  }

  logger.debug('Item processed successfully', {
    itemId,
    source,
    runTotal: safetyState.processing.itemsProcessedThisRun,
    hourTotal: safetyState.processing.itemsProcessedThisHour,
    dayTotal: safetyState.processing.itemsProcessedThisDay
  });
}

/**
 * Record failed processing of an item
 */
export function recordFailure(itemId, source, error) {
  safetyState.errorTracker.consecutiveFailures += 1;
  safetyState.errorTracker.totalFailures += 1;
  safetyState.errorTracker.totalAttempts += 1;

  logger.warn('Item processing failed', {
    itemId,
    source,
    error: error.message,
    consecutiveFailures: safetyState.errorTracker.consecutiveFailures,
    totalFailures: safetyState.errorTracker.totalFailures,
    failureRate: safetyState.errorTracker.totalFailures / safetyState.errorTracker.totalAttempts
  });

  // Log warning if approaching limits
  if (safetyState.errorTracker.consecutiveFailures >= safetyState.errorTracker.maxConsecutiveFailures - 2) {
    console.log(chalk.yellow(`⚠️  Warning: ${safetyState.errorTracker.consecutiveFailures} consecutive failures`));
    console.log(chalk.gray(`   Will stop at ${safetyState.errorTracker.maxConsecutiveFailures}`));
  }
}

/**
 * Validate data before processing
 */
export function validateData(data, source) {
  if (!data) {
    return { valid: false, reason: 'Data is null or undefined' };
  }

  // Basic structure validation by source
  switch (source) {
    case 'pinboard':
      if (!data.href && !data.url) {
        return { valid: false, reason: 'Pinboard bookmark missing URL' };
      }
      break;

    case 'mastodon':
      if (!data.id) {
        return { valid: false, reason: 'Mastodon status missing ID' };
      }
      break;

    case 'arena':
      if (!data.id) {
        return { valid: false, reason: 'Arena block missing ID' };
      }
      break;

    case 'github':
      if (!data.id && !data.node_id) {
        return { valid: false, reason: 'GitHub item missing ID' };
      }
      break;
  }

  // Check for malformed JSON or circular references
  try {
    JSON.stringify(data);
  } catch (error) {
    return { valid: false, reason: `Data serialization failed: ${error.message}` };
  }

  return { valid: true };
}

/**
 * Get current safety status for monitoring
 */
export function getSafetyStatus() {
  const sessionStats = getSessionStats();

  return {
    costBreaker: {
      ...safetyState.costBreaker,
      currentSessionCost: sessionStats.totalCost,
      percentOfLimit: (sessionStats.totalCost / safetyState.costBreaker.sessionLimit) * 100
    },
    errorTracker: {
      ...safetyState.errorTracker,
      failureRate: safetyState.errorTracker.totalAttempts > 0
        ? safetyState.errorTracker.totalFailures / safetyState.errorTracker.totalAttempts
        : 0
    },
    processing: {
      ...safetyState.processing,
      limits: safetyState.processing.isAutomated
        ? safetyState.batchLimits.automated
        : safetyState.batchLimits.manual
    },
    systemResources: {
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptimeHours: Math.round(process.uptime() / 3600 * 100) / 100
    }
  };
}

/**
 * Reset cost circuit breaker (manual intervention)
 */
export function resetCostCircuitBreaker() {
  safetyState.costBreaker.tripped = false;
  logger.info('Cost circuit breaker manually reset');
  console.log(chalk.green('✅ Cost circuit breaker reset'));
}

/**
 * Reset error tracking (manual intervention)
 */
export function resetErrorTracking() {
  safetyState.errorTracker.consecutiveFailures = 0;
  safetyState.errorTracker.totalFailures = 0;
  safetyState.errorTracker.totalAttempts = 0;
  safetyState.errorTracker.windowStart = Date.now();

  logger.info('Error tracking manually reset');
  console.log(chalk.green('✅ Error tracking reset'));
}

/**
 * Print safety status to console
 */
export function printSafetyStatus() {
  const status = getSafetyStatus();

  console.log(chalk.blue('\n🛡️  SAFETY MANAGER STATUS'));
  console.log(chalk.blue('━'.repeat(40)));

  console.log(chalk.yellow('\n💰 Cost Protection:'));
  console.log(`Current: ${chalk.green('$' + status.costBreaker.currentSessionCost.toFixed(4))} / $${status.costBreaker.sessionLimit}`);
  console.log(`Usage: ${chalk.blue(status.costBreaker.percentOfLimit.toFixed(1) + '%')}`);
  console.log(`Tripped: ${status.costBreaker.tripped ? chalk.red('YES') : chalk.green('NO')}`);

  console.log(chalk.yellow('\n⚠️  Error Protection:'));
  console.log(`Consecutive Failures: ${status.errorTracker.consecutiveFailures}/${status.errorTracker.maxConsecutiveFailures}`);
  console.log(`Failure Rate: ${chalk.blue((status.errorTracker.failureRate * 100).toFixed(1) + '%')}`);

  console.log(chalk.yellow('\n📊 Batch Limits:'));
  console.log(`Mode: ${status.processing.isAutomated ? chalk.blue('Automated') : chalk.green('Manual')}`);
  console.log(`This Run: ${status.processing.itemsProcessedThisRun}/${status.processing.limits.maxItemsPerRun}`);
  console.log(`This Hour: ${status.processing.itemsProcessedThisHour}/${status.processing.limits.maxItemsPerHour}`);
  console.log(`Today: ${status.processing.itemsProcessedThisDay}/${status.processing.limits.maxItemsPerDay}`);

  console.log(chalk.yellow('\n💾 System Resources:'));
  console.log(`Memory: ${status.systemResources.memoryUsageMB}MB`);
  console.log(`Uptime: ${status.systemResources.uptimeHours}h`);

  console.log(chalk.blue('━'.repeat(40)));
}

// Initialize safety manager on import
initializeSafetyManager();