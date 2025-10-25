import { completion, MODELS, PROMPTS, loadCoreTags } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";
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
  const { scrapId, taskType = 'summarization', ...otherOptions } = options;

  if (!content) {
    log("❌ No content to summarize");
    return null;
  }

  try {
    log(`🔍 Original content length: ${content.length}`);

    // Clean up HTML content if present
    const cleanContent = content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    log(`📝 Cleaned content length: ${cleanContent.length}`);
    log(`📝 Content preview: ${cleanContent.slice(0, 100)}...`);

    if (!cleanContent) {
      log("❌ No content after cleaning");
      return null;
    }

    // Configure chunk size based on model
    const chunkSizeTokens = options.chunkSize || 120000;
    log(`📏 Using chunk size: ${chunkSizeTokens}`);

    // Break content into chunks
    const chunks = breakContentIntoChunks(cleanContent, chunkSizeTokens);
    log(`📑 Split into ${chunks.length} chunks`);
    chunks.forEach((chunk, i) => {
      log(`Chunk ${i + 1} length: ${chunk.length}`);
    });

    // Process chunks
    log("🤖 Generating summaries...");
    const summaries = [];
    for (const [i, chunk] of chunks.entries()) {
      try {
        log(`Processing chunk ${i + 1}/${chunks.length}`);
        const summary = await limiter.schedule(async () => {
          log(`🔄 Starting chunk ${i + 1} summarization...`);
          const result = await summarizeChunk(chunk, { ...otherOptions, scrapId, taskType });
          log(
            `✅ Chunk ${i + 1} summary generated (${result?.length || 0} chars)`
          );
          return result;
        });
        if (summary) {
          summaries.push(summary);
          log(`✅ Chunk ${i + 1} summary added to results`);
        } else {
          log(`⚠️ Chunk ${i + 1} summary was null, skipping`);
        }
      } catch (error) {
        console.error(`❌ Error processing chunk ${i + 1}:`, error);
        log(`⚠️ Continuing with remaining chunks...`);
      }
    }

    if (summaries.length === 0) {
      log("❌ No summaries were generated");
      return null;
    }

    // Combine summaries
    const summary = summaries.join("\n").trim();
    log(`✅ Final summary generated (${summary.length} chars)`);
    log(`📝 First line: ${summary.split("\n")[0]}`);

    return summary;
  } catch (error) {
    console.error("❌ Error in summarization:", error);
    console.error(error.stack);
    return null;
  }
}

async function summarizeChunk(chunk, options = {}) {
  const { scrapId, taskType = 'summarization', ...otherOptions } = options;
  const startTime = performance.now();
  let summary = null;
  let retries = 0;
  let messages = otherOptions.messages || [];

  const blacklistInstruction = `The following phrases are not allowed in the summary: ${blacklistPhrases
    .map((phrase) => `"${phrase}"`)
    .join(", ")}.`;

  // Create properly formatted messages array
  const systemMessage = {
    role: "system",
    content:
      "You are an expert content analyst helping someone build their digital memory. Your summaries help them remember why they saved something, what was interesting about it, and all the key information they might want to recall later. Be thorough, insightful, and capture the essence of why this content matters.",
  };

  const userMessage = {
    role: "user",
    content: `You are summarizing content for a digital memory system. Create a rich, detailed summary that captures everything interesting and useful.

Instructions:
• Generate as many bullet points as the content warrants (typically 5-15)
• Each point must start with "• "
• Be comprehensive - capture ALL interesting facts, insights, quotes, numbers, dates, names
• For articles: main thesis, supporting arguments, evidence, counterpoints, conclusions, author insights
• For code/docs: purpose, key features, how it works, API details, examples, limitations
• For products: all features, pricing tiers, technical specs, use cases, comparisons
• For social media: the actual content of posts, discussions, key points made

Write in a natural, informative style. Be specific and detailed. Include context that helps understand why this was saved.

${blacklistInstruction}

Content to summarize:
${chunk}`,
  };

  while (summary === null && retries < 3) {
    try {
      log(`🔄 Attempt ${retries + 1}/3 to generate summary...`);
      const response = await completion({
        messages: [systemMessage, userMessage, ...messages],
        temperature: options.temperature || 0.3,
        maxTokens: options.metaSummary ? 2048 : 16384,  // Doubled the output limit
        model: getModelForTask('summarization'),
        scrapId,
        taskType,
      });

      if (!response) {
        log(`⚠️ Attempt ${retries + 1} failed - no response from API`);
        retries++;
        continue;
      }

      summary = response;
      log(`✅ Got response of ${summary.length} chars`);

      if (blacklistPhrases.some((phrase) => summary?.trim().includes(phrase))) {
        log(
          `⚠️ Summary contains blacklisted phrase. Retrying... (Attempt ${
            retries + 1
          })`
        );
        messages.push({
          role: "user",
          content: userMessage.content,
        });
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
      log(
        `❌ Error during completion (Attempt ${retries + 1}): ${error.message}`
      );
      if (error.response?.data) {
        log(
          `API Response Data: ${JSON.stringify(error.response.data, null, 2)}`
        );
      }
      messages.push({
        role: "assistant",
        content: `Error: ${error.message}`,
      });
      retries++;

      // Add delay between retries
      if (retries < 3) {
        const delay = retries * 1000;
        log(`⏳ Waiting ${delay}ms before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);

  if (summary) {
    log(`✅ Successfully generated summary in ${duration}ms`);
  } else {
    log(
      `❌ Failed to generate summary after ${retries} attempts (${duration}ms)`
    );
  }

  return summary;
}

export async function metaSummaryToTags(summary, options = {}) {
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
      scrapId: options.scrapId,
      taskType: 'tagging',
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
      const tags = await metaSummaryToTags(summary, {});
      console.log("Tags:", tags);
    })
    .catch(console.error);
}
