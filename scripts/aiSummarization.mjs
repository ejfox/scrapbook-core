import { completion, MODELS, PROMPTS, loadCoreTags } from './llmService.mjs';
import { breakContentIntoChunks } from "../helpers.js";
import Bottleneck from "bottleneck";

const DEBUG = process.env.DEBUG === "true";
function log(...args) {
  if (DEBUG) console.log(...args);
}

// Rate limiting
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000
});

// Summarization-specific prompts
const SUMMARY_PROMPTS = {
  SUMMARIZE: `When analyzing content, your goal is to:
- Extract key information into standalone bullet points
- Preserve technical details, URLs, and specific references
- Focus on unique or significant points
- Keep each point self-contained
- Be concise but precise
- Include verbatim quotes when relevant

Format as a list of clear, independent facts.`,

  TAGS: async (content) => {
    const coreTags = await loadCoreTags();
    return `You are tagging content. Choose 2-3 most relevant tags from this list:
${coreTags.join('\n')}

Content to tag:
${content}

Return only valid tags from the list above, one per line, no explanations.`;
  }
};

export async function summarizeContent(content, options = {}) {
  if (!content) {
    log("❌ No content to summarize");
    return null;
  }

  try {
    // Configure chunk size based on model
    const chunkSizeTokens = options.chunkSize || 120000;
    log(`🔄 Processing ${content.length} characters...`);

    // Break content into chunks
    const chunks = breakContentIntoChunks(content, chunkSizeTokens);
    log(`📑 Split into ${chunks.length} chunks`);
    
    chunks.forEach((chunk, i) => {
      log(`  Chunk ${i + 1}: ${chunk.length} chars`);
    });

    // Process chunks
    log("🤖 Generating summaries...");
    const summaries = await Promise.all(
      chunks.map(chunk => 
        limiter.schedule(() => summarizeChunk(chunk, options))
      )
    );

    // Combine summaries
    const summary = summaries.join("\n");
    log(`✅ Summarized to ${summary.length} characters`);
    log(`First line: ${summary.split("\n")[0]}`);

    // Generate meta summary if requested
    if (options.metaSummary) {
      log("📊 Generating meta summary...");
      return await summarizeChunk(summary, { ...options, meta: true });
    }

    return summary;

  } catch (error) {
    console.error("❌ Error in summarization:", error);
    return null;
  }
}

async function summarizeChunk(content, options = {}) {
  const messages = [
    { 
      role: "system", 
      content: options.prompt || SUMMARY_PROMPTS.SUMMARIZE 
    },
    { 
      role: "user", 
      content: `${content}\nProvide a clear summary focusing on key information and technical details.`
    }
  ];

  return await completion({
    messages,
    model: MODELS.SUMMARIZE,
    temperature: options.temperature || 0.3,
    max_tokens: options.meta ? 500 : 2000
  });
}

export async function metaSummaryToTags(summary) {
  if (!summary) {
    log("❌ No summary to tag");
    return [];
  }

  try {
    log("🏷️ Generating tags...");
    const messages = [
      { 
        role: "system", 
        content: await SUMMARY_PROMPTS.TAGS(summary)
      },
      { role: "user", content: summary }
    ];

    const response = await completion({
      messages,
      model: MODELS.GENERATE_TAGS,
      temperature: 0.2,
      max_tokens: 100
    });

    const tags = response
      .split('\n')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    log(`✅ Generated ${tags.length} tags:`, tags);
    return tags;

  } catch (error) {
    console.error("❌ Error generating tags:", error);
    return [];
  }
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testContent = `
    This is a test article about Vue.js composition API and performance optimization.
    It includes code examples and best practices for using ref() and computed().
    The article discusses various technical aspects of Vue 3 development.
  `;

  console.log("🧪 Testing summarization...");
  summarizeContent(testContent, { metaSummary: true })
    .then(async summary => {
      console.log("\n📝 Summary:");
      console.log(summary);
      
      console.log("\n🏷️ Generating tags...");
      const tags = await metaSummaryToTags(summary);
      console.log("Tags:", tags);
    })
    .catch(console.error);
}
