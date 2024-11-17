import { completion, MODELS, PROMPTS, loadCoreTags } from './llmService.mjs';
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

// Mastodon-specific prompts
const MASTODON_PROMPTS = {
  SUMMARIZE: `You are analyzing a Mastodon status. Your goal is to create a clear, concise summary that captures:
- The main message or topic
- Any media attachments or links
- Context and references
- Hashtags and mentions
Be specific but concise, preserving key details while removing noise.`,

  TAGS: async (content) => {
    const coreTags = await loadCoreTags();
    return `You are tagging a Mastodon status. Choose 2-3 most relevant tags from this list:
${coreTags.join('\n')}

Content to tag:
${content}

Return only valid tags from the list above, one per line, no explanations.
Include any relevant hashtags from the original post.`;
  }
};

export async function generateMastodonTags(status) {
  if (!status) {
    log("❌ No status to tag");
    return [];
  }

  try {
    log("🔍 Formatting Mastodon status for tagging...");
    const content = formatMastodonStatusForTagging(status);
    
    if (!content) {
      log("❌ No content after formatting");
      return [];
    }

    log(`📝 Content prepared (${content.length} chars)`);
    return await limiter.schedule(() => 
      generateTagsForMastodonStatus(content)
    );

  } catch (error) {
    console.error("❌ Error generating tags:", error);
    return [];
  }
}

export function formatMastodonStatusForTagging(status) {
  try {
    let formattedContent = `Status: ${status.content}\n`;
    formattedContent += `Created at: ${status.created_at}\n`;

    // Add media attachments
    if (status.media_attachments?.length > 0) {
      formattedContent += "Media attachments:\n";
      status.media_attachments.forEach((media, index) => {
        formattedContent += `  ${index + 1}. Type: ${media.type}, Description: ${
          media.description || "No description"
        }\n`;
      });
    }

    // Add existing tags
    if (status.tags?.length > 0) {
      formattedContent += "Existing tags: " + 
        status.tags.map(tag => tag.name).join(", ") + "\n";
    }

    // Add visibility and language
    formattedContent += `Visibility: ${status.visibility}\n`;
    formattedContent += `Language: ${status.language || 'unknown'}\n`;

    return formattedContent;
  } catch (error) {
    console.error("Error formatting status:", error);
    return null;
  }
}

async function generateTagsForMastodonStatus(content) {
  try {
    const messages = [
      { 
        role: "system", 
        content: await MASTODON_PROMPTS.TAGS(content)
      },
      { role: "user", content }
    ];

    const response = await completion({
      messages,
      model: MODELS.GENERATE_TAGS,
      temperature: 0.3,
      max_tokens: 100
    });

    const tags = response
      .split('\n')
      .map(tag => tag.replace('#', '').trim())
      .filter(tag => tag.length > 0);

    log(`✅ Generated ${tags.length} tags:`, tags);
    return tags;

  } catch (error) {
    console.error("Error generating tags:", error);
    return [];
  }
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testStatus = {
    content: "Just released a new version of our Vue component library! #vuejs #webdev",
    created_at: new Date().toISOString(),
    media_attachments: [
      { type: "image", description: "Screenshot of the Vue component library" }
    ],
    tags: [{ name: "vuejs" }, { name: "webdev" }],
    visibility: "public",
    language: "en"
  };

  console.log("🧪 Testing Mastodon tag generation...");
  generateMastodonTags(testStatus)
    .then(tags => {
      console.log("\n📝 Generated tags:", tags);
    })
    .catch(console.error);
}
