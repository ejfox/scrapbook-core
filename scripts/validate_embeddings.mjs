import { generateEmbedding, generateImageEmbedding } from "./llmService.mjs";
import chalk from "chalk";
import { performance } from "perf_hooks";
import { program } from "commander";
import dotenv from "dotenv";

dotenv.config();

console.log(
  chalk.cyan(`
+====================================+
|      EMBEDDINGS VALIDATION UTILITY  |
|  ------------------------------------  |
|    [STATUS: INITIALIZING TESTS]     |
+====================================+
`)
);

// Add command line options
program
  .option("--text-only", "Only test text embeddings")
  .option("--image-only", "Only test image embeddings")
  .option("--debug", "Enable debug mode")
  .parse(process.argv);

const options = program.opts();
const DEBUG = options.debug || process.env.DEBUG === "true";

// Simple test cases
const TEST_CASES = {
  text: [
    "Vue.js is a progressive JavaScript framework.",
    "While coding at a café in Brooklyn, I discovered a new way to handle Vue.js state management.",
    "The ref() function in Vue 3 creates a reactive reference that can hold any value type.",
  ],
  image: [
    "https://res.cloudinary.com/ejf/image/upload/v1732053354/IMG_0010.jpg",
    "https://res.cloudinary.com/ejf/image/upload/c_scale,w_800/v1732053354/IMG_0010.jpg",
  ],
};

// Expected dimensions
const EXPECTED_DIMENSIONS = {
  text: 768, // Nomic text embeddings
  image: 768, // Nomic image embeddings
};

async function validateEmbedding(input, type = "text") {
  console.log("\n" + "=".repeat(50));
  console.log(chalk.blue(`Testing ${type} Embedding:`));

  if (type === "text") {
    console.log(
      `Input: ${input.substring(0, 100)}${input.length > 100 ? "..." : ""}`
    );
  } else {
    console.log(`Image URL: ${input}`);
  }

  try {
    console.time("Generation Time");

    // Use our existing embedding functions
    const embedding =
      type === "text"
        ? await generateEmbedding(input)
        : await generateImageEmbedding(input);

    console.timeEnd("Generation Time");

    if (!embedding) {
      console.log(chalk.red("❌ No embedding generated"));
      return false;
    }

    // Validate dimensions
    const dimensions = embedding.length;
    const expectedDim = EXPECTED_DIMENSIONS[type];
    const isValidDim = dimensions === expectedDim;

    if (isValidDim) {
      console.log(chalk.green(`✓ Valid dimensions: ${dimensions}`));
    } else {
      console.log(
        chalk.red(
          `❌ Invalid dimensions: got ${dimensions}, expected ${expectedDim}`
        )
      );
    }

    // Basic stats in debug mode
    if (DEBUG) {
      const stats = {
        min: Math.min(...embedding),
        max: Math.max(...embedding),
        mean: embedding.reduce((a, b) => a + b, 0) / embedding.length,
      };

      console.log(chalk.gray("\nEmbedding Statistics:"));
      console.log(chalk.gray(`Min: ${stats.min.toFixed(4)}`));
      console.log(chalk.gray(`Max: ${stats.max.toFixed(4)}`));
      console.log(chalk.gray(`Mean: ${stats.mean.toFixed(4)}`));
    }

    return isValidDim;
  } catch (error) {
    console.error(
      chalk.red(`❌ Error generating ${type} embedding:`),
      error.message
    );
    if (DEBUG) {
      console.error(chalk.gray("Full error:"), error);
    }
    return false;
  }
}

async function runTests() {
  const startTime = performance.now();

  try {
    // Check for required environment variables
    if (!process.env.NOMIC_API_KEY) {
      throw new Error("NOMIC_API_KEY not found in environment variables");
    }

    const results = {
      text: { passed: 0, total: 0 },
      image: { passed: 0, total: 0 },
    };

    // Text embeddings
    if (!options.imageOnly) {
      console.log(chalk.cyan("\n📝 Testing Text Embeddings"));
      for (const text of TEST_CASES.text) {
        results.text.total++;
        if (await validateEmbedding(text, "text")) {
          results.text.passed++;
        }
      }
    }

    // Image embeddings
    if (!options.textOnly) {
      console.log(chalk.cyan("\n🖼️ Testing Image Embeddings"));
      for (const imageUrl of TEST_CASES.image) {
        results.image.total++;
        if (await validateEmbedding(imageUrl, "image")) {
          results.image.passed++;
        }
      }
    }

    // Print summary
    const duration = ((performance.now() - startTime) / 1000).toFixed(2);

    console.log(chalk.cyan("\n📊 Test Results Summary"));
    console.log(chalk.cyan("━".repeat(50)));

    if (!options.imageOnly) {
      console.log(
        `Text Embeddings: ${chalk.green(results.text.passed)}/${
          results.text.total
        } passed`
      );
    }

    if (!options.textOnly) {
      console.log(
        `Image Embeddings: ${chalk.green(results.image.passed)}/${
          results.image.total
        } passed`
      );
    }

    console.log(chalk.cyan("━".repeat(50)));
    console.log(chalk.blue(`\n✨ Tests completed in ${duration}s`));
  } catch (error) {
    console.error(chalk.red("\n❌ Error:"), error.message);
    if (DEBUG) {
      console.error(chalk.gray("Full error:"), error);
    }
    process.exit(1);
  }
}

// Run tests with error handling
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error(chalk.red("\n❌ Fatal error:"), error);
    process.exit(1);
  });
}

export { validateEmbedding };
