import os from "os";

export function getInstanceName() {
  // If we're on Fly.io
  if (process.env.FLY_ALLOC_ID) {
    return `fly-${process.env.FLY_REGION || "unknown"}-${
      process.env.FLY_ALLOC_ID
    }`;
  }

  // Local development
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, "-");
  const timestamp = Date.now();
  return `dev-${hostname}-${timestamp}`;
}

// Export a singleton instance name to ensure consistency
export const INSTANCE_NAME = getInstanceName();
