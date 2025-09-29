import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";

// Validate relationship structure before returning
function validateRelationship(rel) {
  return rel &&
    typeof rel === 'object' &&
    rel.source &&
    typeof rel.source === 'object' &&
    typeof rel.source.type === 'string' &&
    typeof rel.source.name === 'string' &&
    rel.target &&
    typeof rel.target === 'object' &&
    typeof rel.target.type === 'string' &&
    typeof rel.target.name === 'string' &&
    typeof rel.type === 'string';
}

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
    const relationships = response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.match(/^\[.+?\]-\[.+?\]->\[.+?\]$/))
      .map((line) => {
        const match = line.match(/^\[(.+?)\]-\[(.+?)\]->\[(.+?)\]$/);
        if (!match) return null;

        const [_, source, relationship, target] = match;

        // Detect entity types based on common patterns
        const detectEntityType = (entity) => {
          const lower = entity.toLowerCase();
          // Check for common patterns
          if (lower.includes('.js') || lower.includes('.py') || lower.includes('react') || lower.includes('vue') || lower.includes('node')) {
            return 'Technology';
          } else if (entity.match(/^[A-Z][a-z]+ [A-Z][a-z]+/)) {
            return 'Person';
          } else if (entity.match(/Inc\.|Corp\.|LLC|Ltd\.|Company|Microsoft|Google|Facebook|Amazon|Apple/i)) {
            return 'Organization';
          } else if (entity.match(/^[A-Z][a-z]+$/)) {
            return 'Concept';
          } else {
            return 'Entity';
          }
        };

        return {
          source: {
            type: detectEntityType(source.trim()),
            name: source.trim()
          },
          target: {
            type: detectEntityType(target.trim()),
            name: target.trim()
          },
          type: relationship.trim()
        };
      })
      .filter(Boolean);

    // Validate all relationships before returning
    const validRelationships = relationships.filter(rel => {
      const isValid = validateRelationship(rel);
      if (!isValid) {
        console.warn("Invalid relationship structure detected, skipping:", rel);
      }
      return isValid;
    });

    console.log(`✅ Extracted ${validRelationships.length} valid relationships (${relationships.length - validRelationships.length} invalid skipped)`);
    return validRelationships;
  } catch (error) {
    console.error("Error extracting relationships:", error);
    return [];
  }
}
