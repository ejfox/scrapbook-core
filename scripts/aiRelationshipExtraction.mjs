import { completion } from './llmService.mjs';

export async function extractRelationships(content, options = {}) {
  if (!content) return [];
  
  const { url, isRawText = false } = options;

  try {
    const prompt = `Extract relationships and connections from this ${isRawText ? 'text' : 'content'}. Focus on:
- People mentioned
- Organizations/companies
- Projects or products
- Key concepts and their relationships
- Technologies and their relationships

Content: ${content}
${url ? `URL: ${url}` : ''}

Return a JSON array of relationship objects with these properties:
- type: The type of relationship (e.g., "person", "organization", "technology", "concept")
- name: The name of the entity
- relationship: How it relates to other entities
- confidence: A number between 0-1 indicating confidence in this relationship

Only return valid JSON. If no relationships are found, return an empty array.`;

    const response = await completion(prompt, {
      temperature: 0.3, // Lower temperature for more consistent extraction
      model: 'anthropic/claude-3-sonnet-20240229' // Use Claude for better extraction
    });

    try {
      // Parse the response, ensuring it's valid JSON
      const relationships = JSON.parse(response);
      
      // Validate and filter relationships
      return relationships
        .filter(r => 
          r && 
          typeof r === 'object' && 
          r.type && 
          r.name && 
          r.relationship &&
          typeof r.confidence === 'number' &&
          r.confidence > 0.5 // Only keep relationships with >50% confidence
        );
    } catch (error) {
      console.error('Failed to parse relationships JSON:', error);
      return [];
    }
  } catch (error) {
    console.error('Error extracting relationships:', error);
    return [];
  }
}
