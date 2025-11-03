/**
 * CIRCUIT BREAKER
 * Stops processing if AI services are failing
 * Prevents wasting money on broken services
 */

import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || "default";
    this.failureThreshold = options.failureThreshold || 3; // Failures before tripping
    this.successThreshold = options.successThreshold || 2; // Successes to reset
    this.timeout = options.timeout || 60000; // 1 minute cooldown
    this.monitorWindow = options.monitorWindow || 10; // Track last N operations

    this.state = "CLOSED"; // CLOSED = healthy, OPEN = failing, HALF_OPEN = testing
    this.failures = [];
    this.successes = [];
    this.lastFailureTime = null;
    this.tripCount = 0;
  }

  recordSuccess() {
    this.successes.push(Date.now());
    // Keep only recent successes
    if (this.successes.length > this.monitorWindow) {
      this.successes.shift();
    }

    // If in HALF_OPEN state and got enough successes, reset
    if (this.state === "HALF_OPEN" && this.successes.length >= this.successThreshold) {
      this.reset();
    } else if (this.state === "OPEN") {
      // Don't reset from OPEN until we enter HALF_OPEN
      return;
    }

    logger.info(`CircuitBreaker[${this.name}]: Success recorded`, {
      state: this.state,
      recentSuccesses: this.successes.length,
      recentFailures: this.failures.length,
    });
  }

  recordFailure(error) {
    this.failures.push({
      time: Date.now(),
      error: error.message || String(error),
    });
    this.lastFailureTime = Date.now();

    // Keep only recent failures
    if (this.failures.length > this.monitorWindow) {
      this.failures.shift();
    }

    // Clear successes on failure
    this.successes = [];

    // Check if we should trip
    if (this.state === "CLOSED" && this.failures.length >= this.failureThreshold) {
      this.trip();
    } else if (this.state === "HALF_OPEN") {
      // Failed during testing, go back to OPEN
      this.trip();
    }

    logger.error(`CircuitBreaker[${this.name}]: Failure recorded`, {
      state: this.state,
      error: error.message || String(error),
      recentFailures: this.failures.length,
      failureThreshold: this.failureThreshold,
    });
  }

  trip() {
    this.state = "OPEN";
    this.tripCount++;
    this.successes = [];

    logger.error(`🚨 CircuitBreaker[${this.name}]: TRIPPED! (trip #${this.tripCount})`, {
      tripCount: this.tripCount,
      recentFailures: this.failures.length,
      lastFailures: this.failures.slice(-3).map(f => f.error),
    });

    // Set timeout to attempt recovery
    setTimeout(() => {
      if (this.state === "OPEN") {
        this.attemptReset();
      }
    }, this.timeout);
  }

  attemptReset() {
    this.state = "HALF_OPEN";
    logger.info(`CircuitBreaker[${this.name}]: Attempting reset (HALF_OPEN)`, {
      tripCount: this.tripCount,
    });
  }

  reset() {
    logger.info(`✅ CircuitBreaker[${this.name}]: Reset to CLOSED (healthy)`, {
      totalTrips: this.tripCount,
    });

    this.state = "CLOSED";
    this.failures = [];
    this.successes = [];
    this.lastFailureTime = null;
  }

  isOpen() {
    return this.state === "OPEN";
  }

  async call(fn) {
    if (this.state === "OPEN") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      throw new Error(
        `CircuitBreaker[${this.name}] is OPEN. Service is failing. ` +
        `Last failure ${Math.floor(timeSinceFailure / 1000)}s ago. ` +
        `${this.failures.length} recent failures. ` +
        `Will retry in ${Math.floor((this.timeout - timeSinceFailure) / 1000)}s.`,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      tripCount: this.tripCount,
      recentFailures: this.failures.length,
      recentSuccesses: this.successes.length,
      lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      failureThreshold: this.failureThreshold,
    };
  }
}

// Create breakers for each service
export const breakers = {
  summarization: new CircuitBreaker({
    name: "summarization",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 120000, // 2 minutes
  }),
  embedding: new CircuitBreaker({
    name: "embedding",
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 120000,
  }),
  relationships: new CircuitBreaker({
    name: "relationships",
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 120000,
  }),
  screenshot: new CircuitBreaker({
    name: "screenshot",
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 60000,
  }),
};

// Check if any critical breaker is open
export function isCriticalSystemDown() {
  const criticalBreakers = ["summarization", "embedding"];
  for (const name of criticalBreakers) {
    if (breakers[name].isOpen()) {
      return true;
    }
  }
  return false;
}

// Get overall system health
export function getSystemHealth() {
  const status = {};
  for (const [name, breaker] of Object.entries(breakers)) {
    status[name] = breaker.getStatus();
  }
  return status;
}

export default CircuitBreaker;
