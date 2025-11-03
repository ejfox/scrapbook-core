#!/usr/bin/env node

/**
 * Test script for SmartRateLimiter with 429 detection and fallback
 * Simulates API calls that hit rate limits and demonstrates automatic backoff
 */

import dotenv from "dotenv";
import { SmartRateLimiter } from "./shared/smartRateLimiter.mjs";
import axios from "axios";
import winston from "winston";

dotenv.config();

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
      }`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// Initialize smart rate limiter
const testLimiter = new SmartRateLimiter("aiServices", { name: "TestLimiter" });

// Mock API call that simulates 429 errors
let callCount = 0;
const mockApiCall = async (shouldFail = false) => {
  callCount++;
  logger.info(`🔄 Making API call #${callCount}`);

  // Simulate some API calls failing with 429
  if (shouldFail || (callCount > 5 && callCount < 15 && Math.random() < 0.7)) {
    const error = new Error("Rate limit exceeded");
    error.response = { status: 429, statusText: "Too Many Requests" };
    throw error;
  }

  // Simulate some API calls being slow
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500));

  return {
    success: true,
    callNumber: callCount,
    message: "API call successful",
  };
};

async function testSmartRateLimiter() {
  logger.info("🚀 Testing SmartRateLimiter with 429 detection...");
  logger.info("📊 Initial status:", testLimiter.getStatus());

  const results = {
    successful: 0,
    failed: 0,
    rateErrors: 0,
  };

  // Make 25 API calls to simulate load
  const promises = [];
  for (let i = 0; i < 25; i++) {
    const promise = testLimiter.schedule(mockApiCall)
      .then(result => {
        results.successful++;
        logger.info(`✅ Call ${i + 1} succeeded:`, result.message);
        return result;
      })
      .catch(error => {
        if (error.response?.status === 429) {
          results.rateErrors++;
          logger.warn(`🚨 Call ${i + 1} hit 429 rate limit`);
        } else {
          results.failed++;
          logger.error(`❌ Call ${i + 1} failed:`, error.message);
        }
        return { error: error.message };
      });

    promises.push(promise);

    // Log status every 5 calls
    if ((i + 1) % 5 === 0) {
      setTimeout(() => {
        logger.info(`📈 Status after ${i + 1} calls:`, testLimiter.getStatus());
      }, 100);
    }
  }

  // Wait for all calls to complete
  await Promise.all(promises);

  // Final results
  logger.info("\n🏁 TEST COMPLETE");
  logger.info("📊 Final Results:", results);
  logger.info("🎛️ Final Rate Limiter Status:", testLimiter.getStatus());

  // Test manual level forcing
  logger.info("\n🧪 Testing manual level control...");
  testLimiter.forceLevel(5); // Force to glacial mode
  logger.info("🐌 Forced to glacial mode - making slow test call...");

  const start = Date.now();
  await testLimiter.schedule(mockApiCall);
  const duration = Date.now() - start;

  logger.info(`⏱️ Glacial call took ${duration}ms (should be ~10+ seconds)`);
  logger.info("✅ Smart Rate Limiter test complete!");
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testSmartRateLimiter()
    .then(() => process.exit(0))
    .catch(error => {
      logger.error("💥 Test failed:", error);
      process.exit(1);
    });
}

export { testSmartRateLimiter };
