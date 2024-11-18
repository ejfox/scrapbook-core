import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import { extractLocation } from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import { generateMastodonTags } from "./aiMastodonSummarization.mjs";
import { summarizeGitHubActivity } from "./aiGithubSummarization.mjs";
import chalk from 'chalk';
import { performance } from 'perf_hooks';

console.log(`
╔═══════════════════════════════════════╗
║         AI VALIDATION UTILITY         ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║
║    [STATUS: INITIALIZING TESTS]       ║
╚═══════════════════════════════════════╝
`);

// Test data
const TEST_CONTENT = `
While working from a cafe in the East Village, New York City, I've been exploring Vue.js 3.0's Composition API, 
a new way to organize component logic. It provides better TypeScript support and more flexible code reuse 
compared to the Options API. The ref() and reactive() functions are core utilities for managing reactive state.
`;

async function runTests() {
  // Test summarization
  console.log("\n[TESTING SUMMARIZATION]");
  try {
    const summary = await summarizeContent(TEST_CONTENT);
    console.log("Summary:", summary);
    
    if (summary) {
      const tags = await metaSummaryToTags(summary);
      console.log("Tags:", tags);
    }
  } catch (error) {
    console.error("❌ Error in summarization:", error);
    console.log("Summary: null");
    console.log("Tags: ");
  }

  // Test location extraction
  console.log("\n[TESTING LOCATION]");
  try {
    const location = await extractLocation(TEST_CONTENT);
    console.log("Location:", location);
  } catch (error) {
    console.error("❌ Error in location extraction:", error);
  }

  // Test relationship extraction
  console.log("\n[TESTING RELATIONSHIPS]");
  try {
    const relationships = await extractRelationships(TEST_CONTENT);
    console.log("Relationships:", relationships);
  } catch (error) {
    console.error("❌ Error in relationship extraction:", error);
  }
}

runTests().catch(console.error); 