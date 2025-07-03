import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";

export async function extractRelationships(content, options = {}) {
  if (!content) return [];

  const { url, isRawText = false } = options;

  try {
    // Create properly formatted messages array
    const messages = [
      {
        role: "system",
        content:
          "You are a relationship extraction specialist. Extract relationships between entities in the text and format them in a Cypher-like syntax. Focus on meaningful connections between people, organizations, technologies, concepts, and places.",
      },
      {
        role: "user",
        content: `Extract relationships from the following text. Return them in Cypher-style format, one per line:
[Entity1]-[RELATIONSHIP]->[Entity2]

Example:
[Vue.js]-[DEVELOPED_BY]->[Evan You]
[React]-[MAINTAINED_BY]->[Facebook]
[TypeScript]-[ENHANCES]->[JavaScript]

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ""}`,
      },
    ];

    const response = await completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model: getModelForTask('contentAnalysis'),
    });

    if (!response) {
      console.log("❌ No response from LLM");
      return [];
    }

    // Parse Cypher-style relationships
    return response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.match(/^\[.+?\]-\[.+?\]->\[.+?\]$/))
      .map((line) => {
        const match = line.match(/^\[(.+?)\]-\[(.+?)\]->\[(.+?)\]$/);
        if (!match) return null;

        const [_, source, relationship, target] = match;
        return {
          source: source.trim(),
          relationship: relationship.trim(),
          target: target.trim(),
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Error extracting relationships:", error);
    return [];
  }
}
