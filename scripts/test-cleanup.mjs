#!/usr/bin/env node
import { generateScreenshot, cleanupTempFiles } from "./generateScreenshot.mjs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import chalk from "chalk";

const TEMP_DIR = path.join(os.tmpdir(), "scrapbook-screenshots");

async function countTempFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    return files.length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function createTestFile(age) {
  const fileName = `test-${Date.now()}-${Math.random()
    .toString(36)
    .substring(7)}.jpg`;
  const filePath = path.join(TEMP_DIR, fileName);

  // Create file
  await fs.writeFile(filePath, "test");

  // Set modified time to simulate age
  const mtime = new Date(Date.now() - age);
  await fs.utimes(filePath, mtime, mtime);

  return filePath;
}

async function runTests() {
  console.log(chalk.blue("\n🧪 Starting cleanup tests...\n"));

  try {
    // Test 1: Basic directory creation
    console.log(chalk.yellow("Test 1: Verify temp directory creation"));
    await fs.mkdir(TEMP_DIR, { recursive: true });
    const exists = await fs
      .stat(TEMP_DIR)
      .then(() => true)
      .catch(() => false);
    console.log(
      exists
        ? chalk.green("✓ Temp directory created successfully")
        : chalk.red("✗ Failed to create temp directory")
    );

    // Test 2: Screenshot generation
    console.log(chalk.yellow("\nTest 2: Test screenshot generation"));
    const testUrl = "https://example.com";
    const beforeCount = await countTempFiles();
    const result = await generateScreenshot(testUrl);
    const afterCount = await countTempFiles();
    console.log(
      result.url
        ? chalk.green("✓ Screenshot generated successfully")
        : chalk.red("✗ Failed to generate screenshot")
    );
    console.log(
      beforeCount === afterCount
        ? chalk.green("✓ Temp files cleaned up after screenshot")
        : chalk.red(
            `✗ Temp files not cleaned up (before: ${beforeCount}, after: ${afterCount})`
          )
    );

    // Test 3: Cleanup of old files
    console.log(chalk.yellow("\nTest 3: Test cleanup of old files"));
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    await createTestFile(TWO_HOURS); // Create a "2-hour-old" file
    const oldFileCount = await countTempFiles();
    await cleanupTempFiles();
    const newFileCount = await countTempFiles();
    console.log(
      newFileCount < oldFileCount
        ? chalk.green("✓ Old files cleaned up successfully")
        : chalk.red("✗ Failed to clean up old files")
    );

    // Test 4: Retention of new files
    console.log(chalk.yellow("\nTest 4: Verify retention of new files"));
    const THIRTY_MINS = 30 * 60 * 1000;
    await createTestFile(THIRTY_MINS); // Create a "30-minute-old" file
    const beforeCleanup = await countTempFiles();
    await cleanupTempFiles();
    const afterCleanup = await countTempFiles();
    console.log(
      beforeCleanup === afterCleanup
        ? chalk.green("✓ New files retained correctly")
        : chalk.red("✗ New files were incorrectly cleaned")
    );

    // Test 5: Error handling
    console.log(chalk.yellow("\nTest 5: Test error handling"));
    try {
      await generateScreenshot("not-a-valid-url");
      console.log(chalk.red("✗ Should have thrown error for invalid URL"));
    } catch (error) {
      console.log(chalk.green("✓ Properly handled invalid URL"));
    }

    // Final cleanup
    console.log(chalk.yellow("\nFinal cleanup"));
    await cleanupTempFiles();
    const finalCount = await countTempFiles();
    console.log(chalk.blue(`Final temp file count: ${finalCount}`));
  } catch (error) {
    console.error(chalk.red("\n❌ Test failed:"), error);
    process.exit(1);
  }
}

// Run tests
runTests()
  .then(() => {
    console.log(chalk.green("\n✨ Tests completed successfully!\n"));
  })
  .catch((error) => {
    console.error(chalk.red("\n❌ Tests failed:"), error);
    process.exit(1);
  });
