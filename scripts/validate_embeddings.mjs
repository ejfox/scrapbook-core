import { generateEmbedding, generateImageEmbedding } from "./llmService.mjs";
import chalk from "chalk";
import { performance } from "perf_hooks";
import axios from "axios";
import fs from "fs/promises";

console.log(
  chalk.cyan(`
╔═══════════════════════════════════════╗
║      EMBEDDINGS VALIDATION UTILITY    ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
╚═══════════════════════════════════════╝
`)
);

// Test cases for text embeddings
const TEXT_TEST_CASES = [
  {
    type: "Short Text",
    content: "Vue.js is a progressive JavaScript framework.",
  },
  {
    type: "Technical Content",
    content:
      "The ref() function in Vue 3 creates a reactive reference that can hold any value type.",
  },
  {
    type: "Mixed Content",
    content:
      "While coding at a café in Brooklyn, I discovered a new way to handle Vue.js state management.",
  },
];

// Test cases for image embeddings with Cloudinary transformations
const IMAGE_TEST_CASES = [
  {
    type: "Large Original",
    url: "https://res.cloudinary.com/ejf/image/upload/v1732053354/IMG_0010.jpg",
  },
  {
    type: "Medium Size",
    url: "https://res.cloudinary.com/ejf/image/upload/c_scale,w_800/v1732053354/IMG_0010.jpg",
  },
  {
    type: "Tiny Preview",
    url: "https://res.cloudinary.com/ejf/image/upload/c_scale,w_200/v1732053354/IMG_0010.jpg",
  },
];

// Define expected dimensions for different models
const EMBEDDING_DIMENSIONS = {
  text: 768, // Nomic's text embeddings are 768-dimensional
  image: 768, // Nomic's image embeddings are also 768-dimensional
};

async function validateEmbeddingDimensions(embedding, type = "text") {
  if (!embedding || !Array.isArray(embedding)) {
    return {
      valid: false,
      error: "Embedding is null or not an array",
    };
  }

  const expectedDim = EMBEDDING_DIMENSIONS[type];

  return {
    valid: embedding.length === expectedDim,
    dimensions: embedding.length,
    expected: expectedDim,
    type: type,
  };
}

async function validateTextEmbedding(text) {
  console.log("\n" + "=".repeat(50));
  console.log(chalk.blue("📝 Testing Text Embedding:"));
  console.log(`Type: ${text.type}`);
  console.log(`Content: ${text.content.substring(0, 100)}...`);

  try {
    console.time("Embedding Generation");
    const embedding = await generateEmbedding(text.content);
    console.timeEnd("Embedding Generation");

    if (!embedding) {
      console.log(chalk.red("❌ No embedding generated"));
      return false;
    }

    const validation = await validateEmbeddingDimensions(embedding, "text");

    if (validation.valid) {
      console.log(
        chalk.green("✓ Valid embedding dimensions:"),
        validation.dimensions
      );
    } else {
      console.log(
        chalk.red("❌ Invalid embedding dimensions:"),
        `Got ${validation.dimensions}, expected ${validation.expected}`
      );
    }

    // Basic statistical checks
    const stats = {
      min: Math.min(...embedding),
      max: Math.max(...embedding),
      mean: embedding.reduce((a, b) => a + b, 0) / embedding.length,
    };

    console.log(chalk.cyan("\nEmbedding Statistics:"));
    console.log(`Min: ${stats.min.toFixed(4)}`);
    console.log(`Max: ${stats.max.toFixed(4)}`);
    console.log(`Mean: ${stats.mean.toFixed(4)}`);

    return validation.valid;
  } catch (error) {
    console.error(chalk.red("❌ Error generating text embedding:"), error);
    return false;
  }
}

async function validateImageEmbedding(image) {
  console.log("\n" + "=".repeat(50));
  console.log(chalk.blue("🖼️ Testing Image Embedding:"));
  console.log(`Type: ${image.type}`);
  console.log(`URL: ${image.url}`);

  try {
    // Fetch image and convert to base64
    console.time("Image Fetch");
    const response = await axios.get(image.url, {
      responseType: "arraybuffer",
    });
    const base64Image = Buffer.from(response.data, "binary").toString("base64");
    console.timeEnd("Image Fetch");

    console.time("Embedding Generation");
    const embedding = await generateImageEmbedding(base64Image);
    console.timeEnd("Embedding Generation");

    if (!embedding) {
      console.log(chalk.red("❌ No embedding generated"));
      return false;
    }

    const validation = await validateEmbeddingDimensions(embedding, "image");

    if (validation.valid) {
      console.log(
        chalk.green("✓ Valid embedding dimensions:"),
        validation.dimensions
      );
    } else {
      console.log(
        chalk.red("❌ Invalid embedding dimensions:"),
        `Got ${validation.dimensions}, expected ${validation.expected}`
      );
    }

    // Basic statistical checks
    const stats = {
      min: Math.min(...embedding),
      max: Math.max(...embedding),
      mean: embedding.reduce((a, b) => a + b, 0) / embedding.length,
    };

    console.log(chalk.cyan("\nEmbedding Statistics:"));
    console.log(`Min: ${stats.min.toFixed(4)}`);
    console.log(`Max: ${stats.max.toFixed(4)}`);
    console.log(`Mean: ${stats.mean.toFixed(4)}`);

    return validation.valid;
  } catch (error) {
    console.error(chalk.red("❌ Error generating image embedding:"), error);
    return false;
  }
}

async function runTests() {
  console.log(chalk.cyan("\n🧪 Starting Embedding Validation Tests"));

  let results = {
    text: { total: 0, passed: 0 },
    image: { total: 0, passed: 0 },
  };

  // Test text embeddings
  console.log(chalk.cyan("\n📝 Testing Text Embeddings"));
  for (const testCase of TEXT_TEST_CASES) {
    results.text.total++;
    if (await validateTextEmbedding(testCase)) {
      results.text.passed++;
    }
  }

  // Test image embeddings
  console.log(chalk.cyan("\n🖼️ Testing Image Embeddings"));
  for (const testCase of IMAGE_TEST_CASES) {
    results.image.total++;
    if (await validateImageEmbedding(testCase)) {
      results.image.passed++;
    }
  }

  // Print summary
  console.log(chalk.cyan("\n📊 Test Results Summary"));
  console.log(chalk.cyan("━".repeat(50)));
  console.log(
    `Text Embeddings: ${results.text.passed}/${results.text.total} passed`
  );
  console.log(
    `Image Embeddings: ${results.image.passed}/${results.image.total} passed`
  );
  console.log(chalk.cyan("━".repeat(50)));
}

// Run tests with error handling
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error(chalk.red("\n❌ Fatal error:"), error);
    process.exit(1);
  });
}
