import Bottleneck from "bottleneck";
import { getRateLimitConfig } from "../../lib/config.mjs";

// Get rate limit configurations
const arenaConfig = getRateLimitConfig("arena");
const processConfig = getRateLimitConfig("process");
const nomicConfig = getRateLimitConfig("nomic");

// Rate limiters using centralized config
export const arenaLimiter = new Bottleneck({
  minTime: arenaConfig.minTimeBetweenRequests,
  maxConcurrent: arenaConfig.maxConcurrent,
});

export const processLimiter = new Bottleneck({
  maxConcurrent: processConfig.maxConcurrent,
  minTime: processConfig.minTimeBetweenRequests,
});

export const nomicLimiter = new Bottleneck({
  maxConcurrent: nomicConfig.maxConcurrent,
  minTime: nomicConfig.minTimeBetweenRequests,
  reservoir: nomicConfig.reservoirSize,
  reservoirRefreshAmount: nomicConfig.reservoirSize,
  reservoirRefreshInterval: 60 * 1000, // 1 minute
});
