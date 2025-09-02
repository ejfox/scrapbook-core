import Bottleneck from "bottleneck";
import { getRateLimitConfig } from "../../lib/config.mjs";
import winston from "winston";

const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Smart Rate Limiter with 429 detection and progressive backoff
 * Falls back to increasingly conservative rate limits when hitting 429s
 */
export class SmartRateLimiter {
  constructor(serviceName, config = {}) {
    this.serviceName = serviceName;
    this.baseConfig = config.baseConfig || getRateLimitConfig(serviceName);
    this.freeModelConfig = getRateLimitConfig('freeModels');
    
    // Backoff levels - each level is more conservative
    this.backoffLevels = [
      { level: 0, name: "normal", minTime: this.baseConfig.minTimeBetweenRequests, maxConcurrent: this.baseConfig.maxConcurrent },
      { level: 1, name: "cautious", minTime: this.baseConfig.minTimeBetweenRequests * 2, maxConcurrent: Math.max(1, Math.floor(this.baseConfig.maxConcurrent / 2)) },
      { level: 2, name: "conservative", minTime: this.baseConfig.minTimeBetweenRequests * 4, maxConcurrent: 1 },
      { level: 3, name: "free-model", minTime: this.freeModelConfig.minTimeBetweenRequests, maxConcurrent: 1 },
      { level: 4, name: "super-polite", minTime: this.freeModelConfig.minTimeBetweenRequests * 2, maxConcurrent: 1 },
      { level: 5, name: "glacial", minTime: 10000, maxConcurrent: 1 } // 10 second delays
    ];
    
    this.currentLevel = 0;
    this.consecutive429s = 0;
    this.lastBackoffTime = 0;
    this.successCount = 0;
    
    this.createLimiter();
    
    logger.info(`🚀 SmartRateLimiter initialized for ${serviceName}`, {
      baseMinTime: this.baseConfig.minTimeBetweenRequests,
      baseConcurrent: this.baseConfig.maxConcurrent,
      backoffLevels: this.backoffLevels.length
    });
  }
  
  createLimiter() {
    const level = this.backoffLevels[this.currentLevel];
    
    if (this.limiter) {
      // Gracefully update existing limiter
      this.limiter.updateSettings({
        minTime: level.minTime,
        maxConcurrent: level.maxConcurrent
      });
    } else {
      this.limiter = new Bottleneck({
        minTime: level.minTime,
        maxConcurrent: level.maxConcurrent,
        reservoir: level.reservoir,
        reservoirRefreshAmount: level.reservoir,
        reservoirRefreshInterval: 60 * 1000, // 1 minute
      });
    }
    
    logger.info(`🔧 Rate limiter updated to level ${this.currentLevel} (${level.name})`, {
      minTime: level.minTime,
      maxConcurrent: level.maxConcurrent,
      service: this.serviceName
    });
  }
  
  async schedule(fn, ...args) {
    return this.limiter.schedule(async () => {
      try {
        const result = await fn(...args);
        this.onSuccess();
        return result;
      } catch (error) {
        this.onError(error);
        throw error;
      }
    });
  }
  
  onSuccess() {
    this.successCount++;
    this.consecutive429s = 0;
    
    // After 10 consecutive successes, try backing off to a less conservative level
    if (this.successCount >= 10 && this.currentLevel > 0) {
      this.currentLevel = Math.max(0, this.currentLevel - 1);
      this.successCount = 0;
      this.createLimiter();
      
      logger.info(`📈 Rate limiter recovery - moving to level ${this.currentLevel}`, {
        service: this.serviceName,
        consecutiveSuccesses: 10
      });
    }
  }
  
  onError(error) {
    if (this.is429Error(error)) {
      this.handle429();
    } else {
      // Reset success count on any error, but don't escalate rate limiting
      this.successCount = 0;
    }
  }
  
  is429Error(error) {
    return (
      error.response?.status === 429 ||
      error.status === 429 ||
      error.code === 429 ||
      (error.message && error.message.includes('rate limit')) ||
      (error.message && error.message.includes('429')) ||
      (error.message && error.message.toLowerCase().includes('too many requests'))
    );
  }
  
  handle429() {
    this.consecutive429s++;
    this.successCount = 0;
    this.lastBackoffTime = Date.now();
    
    // Escalate backoff level based on consecutive 429s
    if (this.consecutive429s >= 3 && this.currentLevel < this.backoffLevels.length - 1) {
      this.currentLevel++;
      this.createLimiter();
      
      const level = this.backoffLevels[this.currentLevel];
      logger.warn(`🚨 429 Rate limit hit - escalating to level ${this.currentLevel} (${level.name})`, {
        service: this.serviceName,
        consecutive429s: this.consecutive429s,
        newMinTime: level.minTime,
        newConcurrent: level.maxConcurrent
      });
    } else {
      logger.warn(`⚠️ 429 Rate limit hit (${this.consecutive429s} consecutive)`, {
        service: this.serviceName,
        currentLevel: this.currentLevel
      });
    }
    
    // If we're at free model level or higher, add extra delay
    if (this.currentLevel >= 3) {
      const extraDelay = Math.min(30000, 5000 * this.consecutive429s); // Up to 30s extra delay
      logger.info(`⏰ Adding extra delay of ${extraDelay}ms for free model politeness`);
      return new Promise(resolve => setTimeout(resolve, extraDelay));
    }
  }
  
  getStatus() {
    const level = this.backoffLevels[this.currentLevel];
    return {
      service: this.serviceName,
      currentLevel: this.currentLevel,
      levelName: level.name,
      minTime: level.minTime,
      maxConcurrent: level.maxConcurrent,
      consecutive429s: this.consecutive429s,
      successCount: this.successCount,
      timeSinceLastBackoff: Date.now() - this.lastBackoffTime
    };
  }
  
  // Method to manually force a specific backoff level (useful for testing)
  forceLevel(level) {
    if (level >= 0 && level < this.backoffLevels.length) {
      this.currentLevel = level;
      this.createLimiter();
      logger.info(`🎛️ Manually set rate limiter to level ${level}`, this.getStatus());
    }
  }
}

// Export singleton instances for common services
export const openRouterLimiter = new SmartRateLimiter('aiServices');
export const nomicLimiter = new SmartRateLimiter('nomic');
export const generalLimiter = new SmartRateLimiter('general');

// Helper function to wrap API calls with smart rate limiting
export async function withSmartRateLimit(limiter, apiCall, ...args) {
  return limiter.schedule(apiCall, ...args);
}