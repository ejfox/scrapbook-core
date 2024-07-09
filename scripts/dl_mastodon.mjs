import * as fs from "fs/promises";
import path from "path";
import axios from "axios";
import ora from "ora";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import { readManifest } from "./manifestHelpers.mjs";
import { fileURLToPath } from "url";

dotenv.config();

const MASTODON_API_URL = "https://mastodon.social/api/v1/";
const USERNAME = "ejfox"; // Replace with your Mastodon username
const ACCESS_TOKEN = process.env.MASTODON_TOKEN;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

const limiter = new Bottleneck({
  minTime: 333,
  maxConcurrent: 1,
});

const axiosInstance = axios.create({
  baseURL: MASTODON_API_URL,
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
  timeout: 10000, // 10 seconds
});

const fetchWithRetry = async (url, params = {}, retries = MAX_RETRIES) => {
  try {
    const response = await axiosInstance.get(url, { params });
    return response.data;
  } catch (error) {
    if (retries > 0 && error.response && error.response.status >= 500) {
      console.warn(
        `Request failed, retrying... (${
          MAX_RETRIES - retries + 1
        }/${MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, params, retries - 1);
    }
    throw error;
  }
};

const fetchUserId = async () => {
  const data = await fetchWithRetry("accounts/search", {
    q: USERNAME,
    resolve: true,
  });
  const user = data.find((user) => user.username === USERNAME);
  return user ? user.id : null;
};

const fetchStatuses = async (userId) => {
  const spinner = ora("Initializing download...").start();
  let allStatuses = [];
  let maxId = null;
  const resultCount = 40;

  try {
    while (true) {
      const data = await limiter.schedule(() =>
        fetchWithRetry(`accounts/${userId}/statuses`, {
          limit: resultCount,
          max_id: maxId,
        })
      );

      allStatuses = allStatuses.concat(data);

      if (data.length < resultCount) break;

      maxId = data[data.length - 1].id;
      spinner.text = `Fetched ${allStatuses.length} statuses...`;
    }

    spinner.succeed(`Downloaded ${allStatuses.length} statuses`);
    return allStatuses;
  } catch (error) {
    spinner.fail(`Error fetching statuses: ${error.message}`);
    throw error;
  }
};

const saveStatuses = async (statuses) => {
  const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
  const filePath = path.join(dirPath, "mastodon.json");

  try {
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(statuses, null, 2));
    console.log(`Saved ${statuses.length} statuses to ${filePath}`);
  } catch (error) {
    console.error("Error saving statuses:", error);
    throw error;
  }
};

const main = async () => {
  try {
    const userId = await fetchUserId();
    if (!userId) {
      throw new Error("User ID could not be found for the specified username.");
    }

    const statuses = await fetchStatuses(userId);
    await saveStatuses(statuses);
  } catch (error) {
    console.error("An error occurred:", error.message);
    process.exit(1);
  }
};

// ES module equivalent of `if (require.main === module)`
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchStatuses, fetchUserId, saveStatuses };
