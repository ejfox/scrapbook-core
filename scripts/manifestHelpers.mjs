import fs from "fs/promises";
import path from "path";

const manifestDir = path.join(process.cwd(), "public", "data", "scrapbook");
const manifestPath = path.join(manifestDir, "manifest.json");

async function ensureManifestDir() {
  try {
    await fs.mkdir(manifestDir, { recursive: true });
  } catch (error) {
    console.error("Failed to create manifest directory:", error);
    throw error;
  }
}

export async function readManifest() {
  await ensureManifestDir();
  try {
    const data = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to read manifest:", error);
    // Return default structure
    return {
      arena: { lastFetch: null, errors: [] },
      github: { lastFetch: null, errors: [] },
      mastodon: { lastFetch: null, errors: [] },
      pinboard: { lastFetch: null, errors: [] },
    };
  }
}

export async function updateManifest(service, { lastFetch, errors = [] }) {
  await ensureManifestDir();
  
  // Add retries and transaction-like behavior
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const currentManifest = await readManifest();
      
      // Only update if our lastFetch is newer
      if (currentManifest[service]?.lastFetch && 
          new Date(lastFetch) <= new Date(currentManifest[service].lastFetch)) {
        log(`Skipping manifest update - newer data exists`);
        return;
      }

      // Update manifest
      currentManifest[service] = {
        ...currentManifest[service],
        lastFetch,
        errors: [...(currentManifest[service]?.errors || []), ...errors]
      };

      await fs.writeFile(manifestPath, JSON.stringify(currentManifest, null, 2));
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}
