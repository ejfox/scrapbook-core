import { completion, MODELS, PROMPTS, loadCoreTags } from "./llmService.mjs";
import { breakContentIntoChunks } from "../helpers.js";
import Bottleneck from "bottleneck";

const DEBUG = process.env.DEBUG === "true";
function log(...args) {
  if (DEBUG) console.log(...args);
}

// Rate limiting
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

const blacklistPhrases = ["Here is a summary"]; // Add more phrases as needed

export async function summarizeContent(content, options = {}) {
  if (!content) {
    log("❌ No content to summarize");
    return null;
  }

  try {
    // Clean up HTML content if present
    const cleanContent = content
      .replace(/<[^>]*>/g, " ") //Improved regex for HTML tag removal
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanContent) {
      log("❌ No content after cleaning");
      return null;
    }

    // Configure chunk size based on model
    const chunkSizeTokens = options.chunkSize || 120000;

    // Break content into chunks
    const chunks = breakContentIntoChunks(cleanContent, chunkSizeTokens);

    // Now we can safely use chunks.length
    log(
      `🔄 Processing ${cleanContent.length} characters in ${chunks.length} chunks...`
    );
    log(`📑 Split into ${chunks.length} chunks`);

    // Process chunks
    log("🤖 Generating summaries...");
    const summaries = await Promise.all(
      chunks.map((chunk) =>
        limiter.schedule(() => summarizeChunk(chunk, options))
      )
    );

    // Combine summaries
    const summary = summaries.join("\n").trim();

    if (!summary) {
      log("❌ No summary generated");
      return null;
    }

    log(`✅ Summarized to ${summary.length} characters`);
    log(`First line: ${summary.split("\n")[0]}`);

    // Generate meta summary if requested
    if (options.metaSummary) {
      log("📊 Generating meta summary...");
      const metaSummary = await summarizeChunk(summary, {
        ...options,
        meta: true,
      });
      log(`✅ Meta-summarized to ${metaSummary.length} characters`);
      return metaSummary;
    }

    return summary;
  } catch (error) {
    console.error("❌ Error in summarization:", error);
    return null;
  }
}

async function summarizeChunk(chunk, options = {}) {
  const startTime = performance.now();
  let summary = null;
  let retries = 0;
  let messages = options.messages || [];

  const blacklistInstruction = `The following phrases are not allowed in the summary: ${blacklistPhrases
    .map((phrase) => `"${phrase}"`)
    .join(", ")}.`;

  // Create properly formatted messages array
  const systemMessage = {
    role: "system",
    content:
      "You are a precise summarizer that creates concise, factual summaries.",
  };

  const userMessage = {
    role: "user",
    content: `Generate a newline-delimited list of concise, factual summary points. Prioritize key information, interesting details, and direct quotes from the provided text. Do not include any introductory or concluding phrases; only provide the list. Focus on telling a story or highlighting the most important aspects. Thoroughly cover the content.

${blacklistInstruction}

Text:
${chunk}`,
  };

  while (summary === null && retries < 3) {
    try {
      const response = await completion({
        messages: [systemMessage, userMessage, ...messages],
        temperature: options.temperature || 0.3,
        maxTokens: options.meta ? 1024 : 8196,
        model: MODELS.CLAUDE_3_SONNET,
      });

      summary = response;

      if (blacklistPhrases.some((phrase) => summary?.trim().includes(phrase))) {
        log(
          `❌ Summary contains blacklisted phrase. Retrying... (Attempt ${
            retries + 1
          })`
        );
        messages.push(userMessage);
        messages.push({
          role: "assistant",
          content:
            summary +
            "\n\nThis response was rejected because it contained a blacklisted phrase.",
        });
        summary = null;
        retries++;
      }
    } catch (error) {
      console.error("❌ Error during completion:", error);
      messages.push({
        role: "assistant",
        content: `Error: ${error.message}`,
      });
      retries++;
    }
  }

  const endTime = performance.now();
  log(`✅ Chunk summarized in ${endTime - startTime}ms`);
  return summary;
}

export async function metaSummaryToTags(summary) {
  if (!summary) {
    log("❌ No summary to tag");
    return [];
  }

  try {
    log("🏷️ Generating tags...");
    const coreTags = await loadCoreTags();

    // Convert prompt to messages array format
    const messages = [
      {
        role: "system",
        content:
          "You are a precise content tagger that selects the most relevant tags from a predefined list.",
      },
      {
        role: "user",
        content: `Choose 2-3 most relevant tags from this list:
${coreTags.join("\n")}

Content to tag:
${summary}

Return only valid tags from the list above, one per line, no explanations.`,
      },
    ];

    const startTime = performance.now();
    const response = await completion({
      messages,
      temperature: 0.2,
      maxTokens: 100,
      // model: MODELS.CLAUDE_3_SONNET,
      // lets use a cheaper model for this
      model: MODELS.GPT_3_5_TURBO,
    });
    const endTime = performance.now();
    log(`✅ Tags generated in ${endTime - startTime}ms`);

    const tags = response
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

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
    .then(async (summary) => {
      console.log("\n📝 Summary:");
      console.log(summary);

      console.log("\n🏷️ Generating tags...");
      const tags = await metaSummaryToTags(summary);
      console.log("Tags:", tags);
    })
    .catch(console.error);
}
