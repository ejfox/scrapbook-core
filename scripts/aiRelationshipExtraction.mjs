import { completion, MODELS, PROMPTS } from './llmService.mjs';

export async function extractRelationships(content, options = {}) {
  if (!content) return [];
  
  const { url, isRawText = false } = options;

  try {
    const prompt = `${PROMPTS.RELATIONSHIPS.EXTRACT}

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ''}`;

    const response = await completion(prompt, {
      temperature: 0.3,
      maxTokens: 1000,
      model: MODELS.CLAUDE_3_SONNET
    });

    // Parse Cypher-style relationships
    return response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.match(/^\[.+?\]-\[.+?\]->\[.+?\]$/))
      .map(line => {
        const match = line.match(/^\[(.+?)\]-\[(.+?)\]->\[(.+?)\]$/);
        if (!match) return null;
        
        const [_, source, relationship, target] = match;
        return {
          source: source.trim(),
          relationship: relationship.trim(),
          target: target.trim()
        };
      })
      .filter(Boolean);

  } catch (error) {
    console.error('Error extracting relationships:', error);
    return [];
  }
}
