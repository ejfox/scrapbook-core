import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import chalk from "chalk";
import { readFile } from "fs/promises";
import { Command } from "commander";

const execAsync = promisify(exec);
const program = new Command();

program
  .option("--debug", "Show debug information")
  .option("--fix", "Attempt to sync missing secrets to Fly.io from .env")
  .parse(process.argv);

const options = program.opts();
const DEBUG = options.debug || process.env.DEBUG === "true";
const FIX = options.fix || false;

console.log(
  chalk.cyan(`
+====================================+
|        SECRETS VALIDATION          |
|  ------------------------------------  |
|    [STATUS: CHECKING SECRETS]      |
+====================================+
`)
);

// Secrets that should only be in local .env, never in production
const LOCAL_ONLY_SECRETS = new Set([
  "DEV",
  "DEBUG",
  "NODE_ENV",
  "CHROME_EXECUTABLE", // Local path to Chrome
]);

async function getEnvSecrets() {
  try {
    // Load .env file
    const envFile = await readFile(".env", "utf8");
    const envSecrets = new Set();

    // Parse each line to get secret names
    envFile.split("\n").forEach((line) => {
      const match = line.match(/^([^=\s#]+)=/);
      if (match && !LOCAL_ONLY_SECRETS.has(match[1])) {
        envSecrets.add(match[1]);
      }
    });

    return envSecrets;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(chalk.red("❌ No .env file found"));
      return new Set();
    }
    throw error;
  }
}

async function getFlySecrets() {
  try {
    const flySecrets = new Set();

    // Check if flyctl is installed
    try {
      await execAsync("flyctl version");
    } catch (error) {
      throw new Error("flyctl not found. Please install Fly.io CLI first.");
    }

    const { stdout } = await execAsync(
      "flyctl secrets list --app scrapbook-core"
    );

    if (DEBUG) {
      console.log(chalk.gray("\nDebug: Raw flyctl output:"));
      console.log(chalk.gray(stdout));
    }

    // Parse flyctl output to get secret names
    stdout.split("\n").forEach((line) => {
      // Skip header line
      if (line.includes("NAME") && line.includes("DIGEST")) return;

      // Match secret name from the Fly.io output format
      const match = line.match(/^([A-Z][A-Z0-9_]*)\s+[a-f0-9]+\s+/);
      if (match) {
        flySecrets.add(match[1]);
      }
    });

    return flySecrets;
  } catch (error) {
    if (error.message.includes("not logged in")) {
      console.error(
        chalk.red("❌ Not logged into Fly.io. Please run `flyctl auth login`")
      );
      process.exit(1);
    }
    if (error.message.includes("not found")) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    if (error.message.includes("app not found")) {
      console.error(
        chalk.red(
          "❌ No Fly.io app found in this directory. Run `flyctl launch` first."
        )
      );
      process.exit(1);
    }
    throw error;
  }
}

async function setFlySecret(name) {
  try {
    // Load value from .env
    const envFile = await readFile(".env", "utf8");
    const match = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));

    if (!match) {
      console.error(chalk.red(`❌ Could not find ${name} in .env`));
      return false;
    }

    const value = match[1].trim();
    console.log(chalk.blue(`Setting ${name} in Fly.io...`));

    await execAsync(`flyctl secrets set ${name}=${value}`);
    console.log(chalk.green(`✓ Set ${name}`));
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to set ${name}:`), error.message);
    return false;
  }
}

async function validateSecrets() {
  try {
    console.log(chalk.blue("🔍 Checking local .env and Fly.io secrets..."));

    const envSecrets = await getEnvSecrets();
    const flySecrets = await getFlySecrets();

    // Find differences
    const missingInFly = [...envSecrets].filter(
      (secret) => !flySecrets.has(secret)
    );
    const missingInEnv = [...flySecrets].filter(
      (secret) => !envSecrets.has(secret)
    );

    // Report results
    console.log(chalk.bold.cyan("\n📊 Secrets Validation Results"));
    console.log(chalk.dim.cyan("━".repeat(50)));

    console.log(chalk.bold.blue(`\n📈 Total Secrets:`));
    console.log(`🔐 Local .env: ${chalk.green.bold(envSecrets.size)} secrets`);
    console.log(`☁️  Fly.io: ${chalk.green.bold(flySecrets.size)} secrets`);

    if (missingInFly.length > 0) {
      console.log(
        chalk.yellow.bold("\n⚠️  Local secrets not yet deployed to Fly.io:")
      );

      if (FIX) {
        console.log(chalk.blue.bold("\n🔄 Syncing secrets to Fly.io..."));
        let successCount = 0;

        for (const secret of missingInFly) {
          if (await setFlySecret(secret)) {
            successCount++;
          }
        }

        console.log(
          chalk.green.bold(
            `\n✨ Sync complete! ${successCount}/${missingInFly.length} secrets deployed`
          )
        );
      } else {
        console.log(
          chalk.blue.dim(
            "\n💡 Tip: Run with --fix to automatically sync secrets to Fly.io"
          )
        );
        console.log(
          chalk.blue.dim(
            "   This will copy values from your local .env to Fly.io secrets"
          )
        );

        missingInFly.forEach((secret) => {
          console.log(chalk.yellow(`  📌 ${secret}`));
          console.log(
            chalk.dim.blue(`      💡 flyctl secrets set ${secret}=<value>`)
          );
        });
      }
    }

    if (missingInEnv.length > 0) {
      console.log(
        chalk.yellow.bold("\n⚠️  Production secrets missing from .env:")
      );
      console.log(
        chalk.yellow.dim(
          "   Note: These secrets exist in production but not in your local environment"
        )
      );
      missingInEnv.forEach((secret) => {
        console.log(chalk.yellow(`  ❗ ${secret}`));
      });
    }

    if (missingInFly.length === 0 && missingInEnv.length === 0) {
      console.log(chalk.green.bold("\n🎉 All secrets are in sync! 🎉"));
    }

    // Print summary
    console.log(chalk.dim.cyan("\n" + "━".repeat(50)));
    console.log(chalk.bold.blue("\n📋 Summary:"));
    console.log(
      `🚀 Missing in Fly.io: ${chalk.yellow.bold(missingInFly.length)}`
    );
    console.log(
      `💻 Missing in .env: ${chalk.yellow.bold(missingInEnv.length)}`
    );

    // Add usage hints at the end if there are any issues
    if (missingInFly.length > 0 || missingInEnv.length > 0) {
      console.log(chalk.cyan.dim("\n📖 Usage:"));
      console.log(
        chalk.dim("  • Check secrets: node scripts/validate_secrets.mjs")
      );
      console.log(
        chalk.dim(
          "  • Auto-sync to Fly.io: node scripts/validate_secrets.mjs --fix"
        )
      );
      console.log(
        chalk.dim(
          "  • Show debug info: node scripts/validate_secrets.mjs --debug"
        )
      );
    }
  } catch (error) {
    console.error(chalk.red("\n❌ Error validating secrets:"), error.message);
    if (process.env.DEBUG === "true") {
      console.error(chalk.gray("Full error:"), error);
    }
    process.exit(1);
  }
}

// Run validation
validateSecrets().catch((error) => {
  console.error(chalk.red("\n❌ Fatal error:"), error);
  process.exit(1);
});
