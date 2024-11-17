import { summarizeContent, metaSummaryToTags } from "./aiSummarization.mjs";
import { extractLocation } from "./aiGeolocation.mjs";
import { extractRelationships } from "./aiRelationshipExtraction.mjs";
import { generateMastodonTags } from "./aiMastodonSummarization.mjs";
import { summarizeGitHubActivity } from "./aiGithubSummarization.mjs";
import chalk from 'chalk';
import { performance } from 'perf_hooks';

// Test samples
const TEST_SAMPLES = {
  content: `Vue.js is a progressive JavaScript framework developed by Evan You in 2014. 
    It's maintained by a dedicated team in multiple locations globally.
    The framework is used by companies like Alibaba in Hangzhou and GitLab in San Francisco.
    Many developers in Paris and Tokyo contribute to its ecosystem.`,
  
  technical_content: `The new Vue 3.4 release includes major updates to the reactivity system.
    It's built on a new Reactivity Transform feature and adds improved TypeScript support.
    The core team, led by Evan You, implemented these changes with contributions from the Vue team in Beijing.`,
  
  news_content: `Vue announced their new Vapor mode at VueConf Toronto.
    The feature will be available globally and was previewed at Vue.js Amsterdam.
    Nuxt Labs in Paris is already working on integration for their framework.`,
  
  github_activity: {
    type: "repository",
    name: "scrapbook-core",
    description: "A Vue.js powered personal knowledge management system for digital ephemera",
    language: "JavaScript",
    stargazers_count: 42,
    user: { login: "ejfox" },
    created_at: "2024-03-17T00:00:00Z",
    updated_at: "2024-03-17T12:00:00Z",
    topics: ["vue", "knowledge-management", "digital-garden", "javascript"],
    html_url: "https://github.com/ejfox/scrapbook-core"
  },
  
  mastodon_status: {
    content: "Just released a new version of our Vue component library! #vuejs #webdev",
    created_at: new Date().toISOString(),
    tags: [{ name: "vuejs" }, { name: "webdev" }],
    visibility: "public",
    language: "en",
    media_attachments: [
      { type: "image", description: "Screenshot of the Vue component library" }
    ]
  }
};

async function validateAI(service) {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║         AI VALIDATION UTILITY         ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾��‾‾‾‾‾‾‾‾‾‾  ║
║    [STATUS: INITIALIZING TESTS]       ║
╚═══════════════════════════════════════╝
`));

  const results = {};
  const startTime = performance.now();

  // Get services to test
  const servicesToTest = service ? [service] : ['summarization', 'location', 'relationships', 'github', 'mastodon'];

  for (const svc of servicesToTest) {
    // Test Summarization
    try {
      console.log(chalk.yellow(`\n[TESTING ${svc.toUpperCase()}]`));
      const summary = await summarizeContent(TEST_SAMPLES.content);
      console.log('Summary:', chalk.white(summary));
      
      const tags = await metaSummaryToTags(summary);
      console.log('Tags:', chalk.cyan(tags.join(', ')));
      
      results[svc] = { success: true };
    } catch (error) {
      console.error(chalk.red(`${svc.toUpperCase()} Error:`, error.message));
      results[svc] = { success: false, error };
    }
  }

  switch(service) {
    case 'location':
      console.log(chalk.yellow('\n[TESTING LOCATION EXTRACTION]'));
      const { location, latitude, longitude, otherLocations } = await extractLocation(TEST_SAMPLES.content);
      
      if (location) {
        console.log('Primary Location:', chalk.white(location));
        console.log('Coordinates:', chalk.cyan(`${latitude}, ${longitude}`));
        
        if (otherLocations?.length > 0) {
          console.log('\nOther Locations:');
          otherLocations.forEach(loc => {
            console.log(chalk.gray(`• ${loc.location}`));
            console.log(chalk.gray(`  ${loc.latitude}, ${loc.longitude}`));
          });
        }
      } else {
        console.log(chalk.yellow('No locations found in content'));
      }
      
      results.location = { success: true };
      break;

    case 'relationships':
      console.log(chalk.yellow('\n[TESTING RELATIONSHIP EXTRACTION]'));
      const relationships = await extractRelationships(TEST_SAMPLES.content);
      
      if (relationships.length > 0) {
        console.log('\nExtracted Relationships:');
        relationships.forEach(rel => {
          console.log(chalk.white(
            `• ${rel.source.type}:${rel.source.name} -> ${rel.type} -> ${rel.target.type}:${rel.target.name}`
          ));
        });
      } else {
        console.log(chalk.yellow('No relationships found'));
      }
      
      results.relationships = { success: true };
      break;

    case 'github':
      console.log(chalk.yellow('\n[TESTING GITHUB ACTIVITY]'));
      const { summarizeGitHubActivity, gitHubSummaryToTags } = await import('./aiGithubSummarization.mjs');
      
      // Use the GitHub test sample
      const githubSummary = await summarizeGitHubActivity(TEST_SAMPLES.github_activity);
      
      if (githubSummary) {
        console.log('\nActivity Summary:');
        console.log(chalk.white(githubSummary));
        
        console.log('\nGenerating tags...');
        const tags = await gitHubSummaryToTags(githubSummary);
        console.log('Generated Tags:', chalk.cyan(tags.join(', ')));
        
        console.log('\nSample Data:');
        console.log(chalk.gray(JSON.stringify(TEST_SAMPLES.github_activity, null, 2)));
        
        results.github = { success: true };
      } else {
        console.log(chalk.red('Failed to process GitHub activity'));
        results.github = { success: false, error: 'Processing failed' };
      }
      break;

    case 'summarization':
      // Use the general content sample for summarization
      console.log(chalk.yellow('\n[TESTING SUMMARIZATION]'));
      const summary = await summarizeContent(TEST_SAMPLES.content);
      console.log('Summary:', chalk.white(summary));
      
      const tags = await metaSummaryToTags(summary);
      console.log('Tags:', chalk.cyan(tags.join(', ')));
      
      results.summarization = { success: true };
      break;

    case 'mastodon':
      console.log(chalk.yellow('\n[TESTING MASTODON STATUS]'));
      const { generateMastodonTags } = await import('./aiMastodonSummarization.mjs');
      
      const mastodonStatus = await generateMastodonTags(TEST_SAMPLES.mastodon_status);
      
      if (mastodonStatus) {
        console.log('\nMastodon Status:');
        console.log(chalk.white(mastodonStatus));
        
        results.mastodon = { success: true };
      } else {
        console.log(chalk.red('Failed to process Mastodon status'));
        results.mastodon = { success: false, error: 'Processing failed' };
      }
      break;
  }

  // Print Summary
  const duration = performance.now() - startTime;
  console.log(chalk.cyan(`
╔═══════════════════════════════════════╗
║         VALIDATION SUMMARY            ║
║  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾  ║`));

  Object.entries(results).forEach(([test, result]) => {
    const status = result.success ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(chalk.cyan(`║  ${test.padEnd(20)} ${status.padEnd(20)} ║`));
  });

  console.log(chalk.cyan(`║  ${'Duration:'.padEnd(20)} ${duration.toFixed(2)}ms${' '.repeat(11)} ║`));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));
}

// Run validation with optional service argument
if (import.meta.url === `file://${process.argv[1]}`) {
  const service = process.argv[2];
  if (service && !['summarization', 'location', 'relationships', 'github', 'mastodon'].includes(service)) {
    console.error(chalk.red(`Invalid service: ${service}`));
    console.log(chalk.yellow('Available services:'));
    console.log('- summarization');
    console.log('- location');
    console.log('- relationships');
    console.log('- github');
    console.log('- mastodon');
    process.exit(1);
  }
  validateAI(service).catch(console.error);
} 