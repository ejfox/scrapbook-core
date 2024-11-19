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

// Test data - reduced to 2 examples
const TEST_CONTENT = [
  `While working from a cafe in the East Village, New York City, I've been exploring Vue.js 3.0's Composition API, 
  a new way to organize component logic. It provides better TypeScript support and more flexible code reuse 
  compared to the Options API.`,
  
  `The ref() and reactive() functions are core utilities for managing reactive state in Vue.js applications.
  These tools help create more maintainable and scalable frontend architectures.`
];

async function runTests() {
  for (const content of TEST_CONTENT) {
    console.log("\n" + "=".repeat(50));
    console.log("Testing content:", content.substring(0, 100) + "...");
    
    // Test summarization
    console.log("\n[TESTING SUMMARIZATION]");
    try {
      console.time('Summary Generation');
      const summary = await summarizeContent(content);
      console.timeEnd('Summary Generation');
      console.log(chalk.green("✓ Summary:"), summary);
      
      if (summary) {
        console.time('Tag Generation');
        const tags = await metaSummaryToTags(summary);
        console.timeEnd('Tag Generation');
        console.log(chalk.green("✓ Tags:"), tags);
      }
    } catch (error) {
      console.error(chalk.red("❌ Error in summarization:"), error);
    }

    // Test location extraction
    console.log("\n[TESTING LOCATION]");
    try {
      console.time('Location Extraction');
      const location = await extractLocation(content);
      console.timeEnd('Location Extraction');
      console.log(chalk.green("✓ Location:"), location);
    } catch (error) {
      console.error(chalk.red("❌ Error in location extraction:"), error);
    }

    // Test relationship extraction
    console.log("\n[TESTING RELATIONSHIPS]");
    try {
      console.time('Relationship Extraction');
      const relationships = await extractRelationships(content);
      console.timeEnd('Relationship Extraction');
      console.log(chalk.green("✓ Relationships:"), relationships);
    } catch (error) {
      console.error(chalk.red("❌ Error in relationship extraction:"), error);
    }
  }
}

runTests().catch(console.error); 