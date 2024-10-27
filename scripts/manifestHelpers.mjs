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
  try {
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch (readError) {
      console.error(
        "Error reading the manifest, initializing new data:",
        readError
      );
      data = {
        arena: { lastFetch: null, errors: [] },
        github: { lastFetch: null, errors: [] },
        mastodon: { lastFetch: null, errors: [] },
        pinboard: { lastFetch: null, errors: [] },
      };
    }

    if (!data[service]) {
      data[service] = { lastFetch: null, errors: [] };
    }
    data[service].lastFetch = lastFetch;
    if (errors.length) {
      data[service].errors.push(...errors);
    }

    await fs.writeFile(manifestPath, JSON.stringify(data, null, 2));
    console.log(`Manifest updated successfully for ${service}`);
  } catch (updateError) {
    console.error(`Failed to update manifest for ${service}:`, updateError);
    throw updateError;
  }
}
