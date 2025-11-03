import sqlite3 from "sqlite3";
import { open } from "sqlite";
import readline from "readline";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function setupDatabase() {
  console.log("Welcome to the Scrapbook SQLite database setup!");

  let dbPath = path.join(os.homedir(), "scraps.db");
  const defaultPath = dbPath;

  const useDefault = await question(
    `Do you want to use the default database location (${defaultPath})? [Y/n] `,
  );

  if (useDefault.toLowerCase() !== "y" && useDefault !== "") {
    dbPath = await question("Enter the full path for your database file: ");
  }

  console.log(`Setting up database at: ${dbPath}`);

  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS scraps USING fts5(
        id,
        source,
        type,
        content,
        summary,
        created_at,
        updated_at,
        tags,
        metadata,
        embedding,
        url,
        screenshot_url,
        location,
        title,
        latitude,
        longitude,
        published_at,
        shared
      );
    `);

    console.log("Database setup complete!");
    console.log("You can now use this database in your Alfred workflow.");
    console.log(`Database location: ${dbPath}`);

    return db;
  } catch (error) {
    console.error("Error setting up database:", error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Check if this module is being run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  setupDatabase();
}

export default setupDatabase;
