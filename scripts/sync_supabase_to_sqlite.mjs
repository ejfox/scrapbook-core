import { createClient } from "@supabase/supabase-js";
import { fetchBookmarksWithCache } from "./dl_pinboard.mjs";
// import { summarizeContent } from "./aiSummarization.mjs";
import ora from "ora";
import chalk from "chalk";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import readline from "readline";
import * as helpers from "../helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const verbose = process.argv.includes("--verbose");

function log(message) {
  if (verbose) {
    console.log(`[VERBOSE] ${message}`);
  }
}

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function initializeDatabase(db) {
  log("Initializing database...");
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scraps (
      id TEXT PRIMARY KEY,
      source TEXT,
      type TEXT,
      content TEXT,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT,
      tags TEXT,
      metadata TEXT,
      url TEXT,
      screenshot_url TEXT,
      location TEXT,
      title TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      published_at TIMESTAMP WITHOUT TIME ZONE,
      shared BOOLEAN DEFAULT false
    )
  `);
  log("Database initialized.");
}

async function syncData(db) {
  console.log(chalk.blue("Starting sync process..."));
  log("Checking environment variables...");

  if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_KEY ||
    !process.env.PINBOARD_TOKEN
  ) {
    console.error(
      chalk.red(
        "Error: SUPABASE_URL, SUPABASE_KEY, and PINBOARD_TOKEN must be set in your .env file in the parent directory.",
      ),
    );
    process.exit(1);
  }

  log("Environment variables checked.");
  log("Initializing Supabase client...");
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
  );
  log("Supabase client initialized.");

  const spinner = ora("Fetching scraps from Supabase").start();
  try {
    log("Fetching scraps from Supabase...");
    const { data: supabaseScraps, error } = await supabase
      .from("scraps")
      .select("*");
    if (error) throw error;
    spinner.succeed(`Fetched ${supabaseScraps.length} scraps from Supabase`);
    log(
      `Supabase scraps: ${JSON.stringify(supabaseScraps.slice(0, 2), null, 2)}`,
    );

    spinner.text = "Fetching bookmarks from Pinboard";
    spinner.start();
    log("Fetching bookmarks from Pinboard...");
    const pinboardBookmarks = await fetchBookmarksWithCache();
    spinner.succeed(
      `Fetched ${pinboardBookmarks.length} bookmarks from Pinboard`,
    );
    log(
      `Pinboard bookmarks: ${JSON.stringify(
        pinboardBookmarks.slice(0, 2),
        null,
        2,
      )}`,
    );

    const allScraps = [...supabaseScraps, ...pinboardBookmarks];
    console.log(chalk.green(`Total scraps to process: ${allScraps.length}`));

    let processed = 0;
    for (const scrap of allScraps) {
      spinner.text = `Processing scrap ${processed + 1}/${allScraps.length}`;
      spinner.start();

      // This is, in fact, too verbose
      // log(`Processing scrap: ${JSON.stringify(scrap, null, 2)}`);

      if (scrap.source === "pinboard" && !scrap.summary) {
        try {
          log("Summarizing content...");
          scrap.summary = await summarizeContent(scrap.content);
          log(`Summary generated: ${scrap.summary}`);
        } catch (error) {
          console.warn(
            chalk.yellow(
              `Warning: Failed to summarize content for scrap ${scrap.id}: ${error.message}`,
            ),
          );
        }
      }

      try {
        log("Inserting scrap into database...");
        await db.run(
          `INSERT OR REPLACE INTO scraps (
            id, source, type, content, summary, created_at, updated_at, tags, metadata,
            url, screenshot_url, location, title, latitude, longitude, published_at, shared
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            scrap.id,
            scrap.source,
            scrap.type || getTypeFromSource(scrap),
            scrap.content,
            scrap.summary,
            scrap.created_at,
            scrap.updated_at,
            JSON.stringify(scrap.tags),
            JSON.stringify(scrap.metadata),
            scrap.url || scrap.metadata?.href,
            scrap.screenshot_url || scrap.metadata?.screenshotUrl,
            scrap.location || scrap.metadata?.location,
            scrap.title || scrap.metadata?.title || scrap.content,
            scrap.latitude || scrap.metadata?.latitude,
            scrap.longitude || scrap.metadata?.longitude,
            scrap.published_at || scrap.created_at,
            scrap.shared || false,
          ],
        );
        log(`Inserted scrap ${scrap.id} into database`);

        // Verify the insert
        const verifyResult = await db.get(
          "SELECT * FROM scraps WHERE id = ?",
          scrap.id,
        );
        log(`Verification result: ${JSON.stringify(verifyResult, null, 2)}`);
      } catch (error) {
        console.error(
          chalk.red(
            `Error inserting scrap ${scrap.id}: ${error.message}`,
          ),
        );
      }

      processed++;
      spinner.text = `Processed ${processed}/${allScraps.length} scraps`;
    }

    spinner.succeed(`Sync complete. Processed ${processed} scraps.`);

    // Final verification
    log("Performing final verification...");
    const finalCount = await db.get("SELECT COUNT(*) as count FROM scraps");
    log(`Total scraps in database: ${finalCount.count}`);
  } catch (error) {
    spinner.fail(`Error during sync: ${error.message}`);
    console.error(chalk.red(error.stack));
  }
}

async function main() {
  const dbPath = path.join(os.homedir(), "scraps.db");
  console.log(chalk.blue(`Opening database at ${dbPath}`));

  try {
    log("Opening database connection...");
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    log("Database connection opened.");

    await initializeDatabase(db);
    await syncData(db);

    log("Closing database connection...");
    await db.close();
    log("Database connection closed.");
  } catch (error) {
    console.error(
      chalk.red(`Failed to open or initialize database: ${error.message}`),
    );
    process.exit(1);
  } finally {
    log("Closing readline interface...");
    rl.close();
    log("Readline interface closed.");
  }
}

// Make sure to use await when calling main
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

// Helper function to determine type
function getTypeFromSource(scrap) {
  switch(scrap.source) {
  case "pinboard": return "bookmark";
  case "mastodon": return "status";
  case "arena": return "block";
  case "github":
    return scrap.metadata?.type || "repo";
  default:
    return scrap.source;
  }
}
