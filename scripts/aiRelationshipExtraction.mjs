import { completion, MODELS, PROMPTS } from './llmService.mjs';
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

// Relationship-specific prompts
const RELATIONSHIP_PROMPTS = {
  EXTRACT: `You are analyzing content to identify relationships between entities. Your goal is to:
- Identify key entities (people, organizations, concepts, technologies)
- Determine how these entities are related
- Specify the type and direction of relationships
- Include any relevant context or qualifiers

Return relationships in this format:
source_type:source_name -> relationship_type -> target_type:target_name

Example:
person:John Smith -> works_for -> company:Acme Corp
technology:React -> depends_on -> technology:JavaScript`,

  VALIDATE: `Validate if this relationship follows the correct format:
source_type:source_name -> relationship_type -> target_type:target_name

The relationship should:
- Have clear source and target entities with types
- Use a meaningful relationship type
- Make logical sense
- Be properly formatted with arrows

Return only "valid" or "invalid".`
};

export async function extractRelationships(content, options = {}) {
  if (!content) {
    log("❌ No content to analyze");
    return [];
  }

  try {
    log("🔍 Analyzing content for relationships...");
    log(`Content length: ${content.length} chars`);
    log(content.substring(0, 100) + "...");

    const messages = [
      { role: "system", content: RELATIONSHIP_PROMPTS.EXTRACT },
      { 
        role: "user", 
        content: `Extract relationships from this content. Return one relationship per line, using the specified format:\n\n${content}`
      }
    ];

    const response = await limiter.schedule(() =>
      completion({
        messages,
        model: MODELS.EXTRACT_RELATIONSHIPS,
        temperature: 0.3,
        max_tokens: 500
      })
    );

    // Parse and validate relationships
    const relationships = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(async line => {
        const relationship = parseRelationship(line);
        if (!relationship) {
          log(`❌ Invalid relationship format: ${line}`);
          return null;
        }

        const isValid = await validateRelationship(line);
        if (!isValid) {
          log(`❌ Invalid relationship: ${line}`);
          return null;
        }

        log(`✅ Valid relationship: ${line}`);
        return relationship;
      });

    const validRelationships = (await Promise.all(relationships)).filter(Boolean);
    log(`Found ${validRelationships.length} valid relationships`);

    return validRelationships;

  } catch (error) {
    console.error("❌ Error extracting relationships:", error);
    return [];
  }
}

function parseRelationship(line) {
  try {
    const parts = line.split('->').map(p => p.trim());
    if (parts.length !== 3) return null;

    const [source, type, target] = parts;
    const [sourceType, sourceName] = source.split(':').map(p => p.trim());
    const [targetType, targetName] = target.split(':').map(p => p.trim());

    if (!sourceType || !sourceName || !type || !targetType || !targetName) {
      return null;
    }

    return {
      source: {
        type: sourceType,
        name: sourceName
      },
      type: type,
      target: {
        type: targetType,
        name: targetName
      }
    };
  } catch (error) {
    log(`Error parsing relationship: ${error.message}`);
    return null;
  }
}

async function validateRelationship(relationshipString) {
  try {
    const messages = [
      { role: "system", content: RELATIONSHIP_PROMPTS.VALIDATE },
      { role: "user", content: relationshipString }
    ];

    const response = await limiter.schedule(() =>
      completion({
        messages,
        model: MODELS.EXTRACT_RELATIONSHIPS,
        temperature: 0.1,
        max_tokens: 10
      })
    );

    return response.toLowerCase().includes('valid');
  } catch (error) {
    log(`Error validating relationship: ${error.message}`);
    return false;
  }
}

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const testContent = `
    React is a JavaScript library developed by Facebook. 
    It depends heavily on Node.js for its build system.
    The React team, led by Dan Abramov, maintains the project.
    Many companies like Airbnb and Netflix use React in production.
  `;

  console.log("Testing relationship extraction...");
  extractRelationships(testContent)
    .then(relationships => {
      console.log("\nExtracted Relationships:");
      relationships.forEach(r => 
        console.log(`${r.source.type}:${r.source.name} -> ${r.type} -> ${r.target.type}:${r.target.name}`)
      );
    })
    .catch(console.error);
}
