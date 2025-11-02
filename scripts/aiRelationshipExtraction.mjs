import { completion, MODELS, PROMPTS } from "./llmService.mjs";
import { getModelForTask } from "../lib/config.mjs";

// Validate relationship structure before returning
function validateRelationship(rel) {
  return rel &&
    typeof rel === 'object' &&
    typeof rel.source === 'string' &&
    rel.source.length > 0 &&
    typeof rel.target === 'string' &&
    rel.target.length > 0 &&
    typeof rel.relationship === 'string' &&
    rel.relationship.length > 0;
}

export async function extractRelationships(content, options = {}) {
  if (!content) return [];

  const { url, isRawText = false, model = null } = options;

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
        content: `Extract relationships from the following text. Return them in enhanced Cypher format with entity types, one per line:
[EntityName:EntityType]-[RELATIONSHIP]->[EntityName:EntityType]

Entity Types to use:
- Person (individuals, people)
- Organization (companies, institutions, agencies)
- Technology (software, frameworks, tools, protocols)
- Product (specific products, services, applications)
- Location (places, cities, countries, regions)
- Event (conferences, meetings, occurrences)
- Concept (abstract ideas, methodologies, principles)

Examples:
[Vue.js:Technology]-[DEVELOPED_BY]->[Evan You:Person]
[React:Technology]-[MAINTAINED_BY]->[Meta:Organization]
[TypeScript:Technology]-[ENHANCES]->[JavaScript:Technology]
[Sam Altman:Person]-[CEO_OF]->[OpenAI:Organization]
[iPhone:Product]-[MANUFACTURED_BY]->[Apple:Organization]
[GitHub:Product]-[ACQUIRED_BY]->[Microsoft:Organization]

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ""}`,
      },
    ];

    const response = await completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model: model || getModelForTask('relationshipAnalysis'),
    });

    if (!response) {
      console.log("❌ No response from LLM");
      return [];
    }

    // Parse Cypher-style relationships with optional entity types
    const relationships = response
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.match(/^\[.+?\]-\[.+?\]->\[.+?\]$/))
      .map((line) => {
        // Handle both formats: [Entity] and [Entity:Type]
        const match = line.match(/^\[(.+?)\]-\[(.+?)\]->\[(.+?)\]$/);
        if (!match) return null;

        const [_, sourceRaw, relationship, targetRaw] = match;

        // Parse entity and type from format "Entity:Type" or just "Entity"
        const parseEntity = (entityStr) => {
          const parts = entityStr.split(':');
          if (parts.length === 2) {
            return {
              name: parts[0].trim(),
              type: parts[1].trim()
            };
          }
          // Fallback to old format without type
          return {
            name: entityStr.trim(),
            type: null
          };
        };

        const sourceParsed = parseEntity(sourceRaw);
        const targetParsed = parseEntity(targetRaw);

        // Detect entity types based on common patterns
        const detectEntityType = (entity) => {
          const lower = entity.toLowerCase();
          const trimmed = entity.trim();

          // Technology patterns - check first as most specific
          const techPatterns = [
            /\.(js|py|java|cpp|c|go|rs|ts|jsx|tsx|vue|rb|php|swift|kt|scala|r|m|h)$/i,
            /^(react|vue|angular|svelte|next\.?js|nuxt|gatsby|webpack|babel|vite|rollup|parcel|esbuild)$/i,
            /^(node\.?js|deno|bun|python|java|c\+\+|rust|golang|ruby|php|swift|kotlin)$/i,
            /^(gpt-\d|claude|llama|bert|transformer|ai|ml|api|sdk|cli|gui|ide)$/i,
            /^(aws|azure|gcp|google cloud|amazon web services|microsoft azure)$/i,
            /^(docker|kubernetes|k8s|terraform|ansible|jenkins|github|gitlab|bitbucket)$/i,
            /^(mysql|postgresql|mongodb|redis|elasticsearch|kafka|rabbitmq|sqlite)$/i,
            /^(http|https|tcp|udp|websocket|graphql|rest|grpc|mqtt)$/i,
            /(framework|library|toolkit|platform|service|database|server|client|protocol|algorithm|technology|software|hardware|system|application|tool|package|module|component|interface|api|sdk)/i
          ];
          if (techPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Technology';
          }

          // Organization patterns - companies, institutions, agencies
          const orgPatterns = [
            /\b(Inc\.?|Corp\.?|LLC|Ltd\.?|GmbH|SA|AG|PLC|Co\.?|Company|Corporation|Group|Holdings|Partners|Associates|Foundation|Institute|University|College|School|Academy|Hospital|Bank|Agency|Department|Ministry|Commission|Committee|Council|Board|Authority|Office|Bureau|Service|Administration|Organization|Association|Society|Union|Federation|Confederation|Alliance|Coalition|Network|Consortium|Trust|Fund)\b/i,
            /^(Microsoft|Google|Facebook|Meta|Amazon|Apple|Netflix|Tesla|SpaceX|OpenAI|Anthropic|DeepMind|IBM|Oracle|Intel|AMD|NVIDIA|Samsung|Sony|Nintendo|Adobe|Salesforce|Uber|Airbnb|Twitter|X|LinkedIn|TikTok|ByteDance|Alibaba|Tencent|Baidu)/i,
            /^(UN|UNESCO|WHO|IMF|World Bank|NATO|EU|NASA|FDA|CDC|FBI|CIA|NSA|MIT|Harvard|Stanford|Oxford|Cambridge)/i
          ];
          if (orgPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Organization';
          }

          // Person patterns - names with common structures
          const personPatterns = [
            /^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Sir|Dame|Lord|Lady)\s+/i,
            /^[A-Z][a-z]+\s+(([A-Z]\.?\s+)?[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z][a-z]+)$/,  // First Last or First M. Last
            /\s+(Jr\.?|Sr\.?|III|IV|V|MD|PhD|Esq\.?)$/i,
            /^[A-Z][a-z]+\s+[A-Z]'[A-Z][a-z]+$/,  // Irish/Scottish names
            /^[A-Z][a-z]+\s+(van|von|de|di|da|del|della|dos|mac|mc|o'|le|la)\s+[A-Z][a-z]+$/i,  // Names with particles
            /(CEO|CTO|CFO|COO|CMO|President|Director|Manager|Engineer|Developer|Designer|Analyst|Scientist|Professor|Doctor|Attorney|Judge|Senator|Representative|Governor|Mayor|Minister|Secretary|Commissioner|Chief|Head|Lead|Principal|Founder|Co-founder|Chairman|Board Member)/i
          ];
          if (personPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Person';
          }

          // Location patterns
          const locationPatterns = [
            /^(United States|Canada|Mexico|Brazil|Argentina|United Kingdom|France|Germany|Spain|Italy|Russia|China|Japan|India|Australia|South Africa)/i,
            /^(New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Austin|Jacksonville|San Francisco|Seattle|Denver|Boston|Washington|Miami|Atlanta|Portland)/i,
            /^(London|Paris|Berlin|Rome|Madrid|Moscow|Beijing|Tokyo|Mumbai|Sydney|Toronto|Vancouver|Montreal|Mexico City|São Paulo|Buenos Aires)/i,
            /\b(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Plaza|Square|Park|City|Town|Village|County|State|Province|Country|Nation|Continent|Ocean|Sea|River|Lake|Mountain|Valley|Desert|Forest|Island)\b/i
          ];
          if (locationPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Location';
          }

          // Product patterns
          const productPatterns = [
            /^(iPhone|iPad|MacBook|iMac|Apple Watch|AirPods|Pixel|Galaxy|Surface|Xbox|PlayStation|Switch)/i,
            /\b(Pro|Plus|Max|Mini|Air|Ultra|Lite|Premium|Standard|Basic|Enterprise|Professional|Personal|Home|Business)\b/i,
            /\b(Version|v\d+|\d+\.\d+|\d{4}|Gen \d+|Generation|Edition|Release|Update|Patch|Build)\b/i
          ];
          if (productPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Product';
          }

          // Concept patterns - abstract ideas, methodologies, etc.
          const conceptPatterns = [
            /^(Democracy|Capitalism|Socialism|Freedom|Justice|Equality|Liberty|Privacy|Security|Innovation|Sustainability|Diversity|Inclusion|Ethics|Morality|Philosophy|Science|Art|Culture|Education|Health|Wealth|Poverty|War|Peace|Love|Hate|Fear|Hope|Faith|Truth|Knowledge|Wisdom|Power|Authority|Responsibility|Accountability)/i,
            /(methodology|approach|strategy|technique|process|procedure|principle|theory|concept|idea|framework|model|pattern|practice|standard|guideline|policy|rule|regulation|law)/i
          ];
          if (conceptPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Concept';
          }

          // Event patterns
          const eventPatterns = [
            /^(World War|Civil War|Revolution|Olympics|World Cup|Super Bowl|Conference|Summit|Symposium|Workshop|Seminar|Meeting|Election|Referendum|Festival|Fair|Expo|Exhibition|Show|Concert|Tour)/i,
            /\b(2019|2020|2021|2022|2023|2024|2025)\b/,
            /(January|February|March|April|May|June|July|August|September|October|November|December)/i
          ];
          if (eventPatterns.some(pattern => pattern.test(trimmed))) {
            return 'Event';
          }

          // If it's a single capitalized word, likely a concept or brand
          if (/^[A-Z][a-z]+$/.test(trimmed)) {
            return 'Concept';
          }

          // Default fallback
          return 'Entity';
        };

        // Return flat structure for database compatibility
        return {
          source: sourceParsed.name,
          target: targetParsed.name,
          relationship: relationship.trim()
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
