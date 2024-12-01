import Bottleneck from "bottleneck";

// Rate limiters
export const arenaLimiter = new Bottleneck({ minTime: 333 });
export const processLimiter = new Bottleneck({ maxConcurrent: 3 });
export const nomicLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: 500, // 500ms between requests
  reservoir: 100, // 100 requests
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000, // Refill every minute
});
