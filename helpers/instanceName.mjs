import os from "os";

export function getInstanceName() {
  // Check for container environment
  if (process.env.CONTAINER_NAME) {
    return process.env.CONTAINER_NAME;
  }

  // Check for hostname override
  if (process.env.INSTANCE_NAME) {
    return process.env.INSTANCE_NAME;
  }

  // Generate based on hostname and environment
  const hostname = os.hostname().replace(/[^a-zA-Z0-9-]/g, "-");
  const env = process.env.NODE_ENV || "dev";
  const timestamp = Date.now();
  return `${env}-${hostname}-${timestamp}`;
}

// Export a singleton instance name to ensure consistency
export const INSTANCE_NAME = getInstanceName();
