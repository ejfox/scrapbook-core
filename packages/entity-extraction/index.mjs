import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

/**
 * @typedef {Object} LLMProvider
 * @property {Function} completion - Function to call LLM completion API
 */

/**
 * @typedef {Object} Relationship
 * @property {string} source - Source entity name
 * @property {string} target - Target entity name
 * @property {string} relationship - Relationship type
 */

/**
 * @typedef {Object} ExtractOptions
 * @property {string} [url] - Source URL for context
 * @property {boolean} [isRawText=false] - Whether content is raw text
 * @property {string} [model] - Override LLM model
 * @property {LLMProvider} llmProvider - LLM provider with completion method
 * @property {Object} [supabaseClient] - Optional Supabase client for examples
 */

// Lazy-load supabase client for relationship examples
let supabaseClient = null
function getSupabase(providedClient = null) {
  if (providedClient) {
    return providedClient
  }
  if (!supabaseClient && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  }
  return supabaseClient
}

/**
 * Fetch real examples from recent scraps
 * @param {number} count - Number of examples to fetch
 * @param {Object} supabaseClient - Optional Supabase client
 * @returns {Promise<string[]>} Array of example relationship strings
 */
async function getRecentRelationshipExamples(count = 9, supabaseClient = null) {
  try {
    const supabase = getSupabase(supabaseClient)
    if (!supabase) return []

    const { data: scraps } = await supabase
      .from('scraps')
      .select('relationships')
      .not('relationships', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3)

    if (!scraps || scraps.length === 0) return []

    const examples = []
    for (const scrap of scraps) {
      if (scrap.relationships?.length) {
        // Pick up to 3 random relationships from each scrap
        const sample = scrap.relationships
          .filter(r => r.source && r.target && r.relationship)
          .sort(() => Math.random() - 0.5)
          .slice(0, 3)
          .map(r => `[${r.source}]-[${r.relationship}]->[${r.target}]`)
        examples.push(...sample)
      }
    }

    return examples.slice(0, count)
  } catch (error) {
    console.warn('Could not fetch recent examples:', error.message)
    return []
  }
}

/**
 * Validate relationship structure before returning
 * @param {Relationship} rel - Relationship object to validate
 * @returns {boolean} Whether relationship is valid
 */
function validateRelationship(rel) {
  return rel &&
    typeof rel === 'object' &&
    typeof rel.source === 'string' &&
    rel.source.length > 0 &&
    typeof rel.target === 'string' &&
    rel.target.length > 0 &&
    typeof rel.relationship === 'string' &&
    rel.relationship.length > 0
}

/**
 * Extract relationships between entities from text content
 * 
 * @param {string} content - Text content to analyze
 * @param {ExtractOptions} options - Extraction options
 * @returns {Promise<Relationship[]>} Array of extracted relationships
 * 
 * @example
 * ```js
 * import { extractRelationships } from '@scrapbook/entity-extraction'
 * 
 * // Define your LLM provider
 * const llmProvider = {
 *   async completion({ messages, temperature, maxTokens, model }) {
 *     // Your LLM API call here
 *     // Return the text response
 *   }
 * }
 * 
 * const content = "Apple acquired Beats for $3 billion. Tim Cook is the CEO of Apple."
 * const relationships = await extractRelationships(content, { llmProvider })
 * // Returns: [
 * //   { source: "Apple", target: "Beats", relationship: "ACQUIRED" },
 * //   { source: "Tim Cook", target: "Apple", relationship: "CEO_OF" }
 * // ]
 * ```
 */
export async function extractRelationships(content, options = {}) {
  if (!content) return []

  const { url, isRawText = false, model = null, llmProvider, supabaseClient } = options

  if (!llmProvider || typeof llmProvider.completion !== 'function') {
    throw new Error('llmProvider with completion method is required')
  }

  try {
    // Fetch recent examples from the archive if available
    const recentExamples = await getRecentRelationshipExamples(9, supabaseClient)
    const examplesText = recentExamples.length > 0
      ? `\n\nExamples (from recently processed scraps in your archive):\n${recentExamples.join('\n')}`
      : ''

    // Create properly formatted messages array
    const messages = [
      {
        role: 'system',
        content:
          'You are a relationship extraction specialist. Extract relationships between entities in the text and format them in a Cypher-like syntax. Focus on meaningful connections between people, organizations, technologies, concepts, and places.',
      },
      {
        role: 'user',
        content: `Extract relationships from the following text. Return them in enhanced Cypher format with entity types, one per line:
[EntityName:EntityType]-[RELATIONSHIP]->[EntityName:EntityType]

Entity Types to use:
- Person (individuals, people)
- Organization (companies, institutions, agencies)
- Technology (software, frameworks, tools, protocols)
- Product (specific products, services, applications)
- Location (places, cities, countries, regions)
- Event (conferences, meetings, occurrences)
- Concept (abstract ideas, methodologies, principles)${examplesText}

Content to analyze:
${content}
${url ? `\nURL: ${url}` : ''}`,
      },
    ]

    const response = await llmProvider.completion({
      messages,
      temperature: 0.3,
      maxTokens: 1000,
      model,
    })

    if (!response) {
      console.log('❌ No response from LLM')
      return []
    }

    // Parse Cypher-style relationships with optional entity types
    const relationships = response
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.match(/^\[.+?\]-\[.+?\]->\[.+?\]$/))
      .map((line) => {
        // Handle both formats: [Entity] and [Entity:Type]
        const match = line.match(/^\[(.+?)\]-\[(.+?)\]->\[(.+?)\]$/)
        if (!match) return null

        const [_, sourceRaw, relationship, targetRaw] = match

        // Parse entity and type from format "Entity:Type" or just "Entity"
        const parseEntity = (entityStr) => {
          const parts = entityStr.split(':')
          if (parts.length === 2) {
            return {
              name: parts[0].trim(),
              type: parts[1].trim(),
            }
          }
          // Fallback to old format without type
          return {
            name: entityStr.trim(),
            type: null,
          }
        }

        const sourceParsed = parseEntity(sourceRaw)
        const targetParsed = parseEntity(targetRaw)

        // Return flat structure for database compatibility
        return {
          source: sourceParsed.name,
          target: targetParsed.name,
          relationship: relationship.trim(),
        }
      })
      .filter(Boolean)

    // Validate all relationships before returning
    const validRelationships = relationships.filter(rel => {
      const isValid = validateRelationship(rel)
      if (!isValid) {
        console.warn('Invalid relationship structure detected, skipping:', rel)
      }
      return isValid
    })

    console.log(`✅ Extracted ${validRelationships.length} valid relationships (${relationships.length - validRelationships.length} invalid skipped)`)
    return validRelationships
  } catch (error) {
    console.error('Error extracting relationships:', error)
    return []
  }
}

/**
 * Entity type patterns for automatic classification
 * These patterns help identify entity types when not explicitly provided
 */
export const ENTITY_TYPE_PATTERNS = {
  technology: [
    /\.(js|py|java|cpp|c|go|rs|ts|jsx|tsx|vue|rb|php|swift|kt|scala|r|m|h)$/i,
    /^(react|vue|angular|svelte|next\.?js|nuxt|gatsby|webpack|babel|vite|rollup|parcel|esbuild)$/i,
    /^(node\.?js|deno|bun|python|java|c\+\+|rust|golang|ruby|php|swift|kotlin)$/i,
    /^(gpt-\d|claude|llama|bert|transformer|ai|ml|api|sdk|cli|gui|ide)$/i,
    /^(aws|azure|gcp|google cloud|amazon web services|microsoft azure)$/i,
    /^(docker|kubernetes|k8s|terraform|ansible|jenkins|github|gitlab|bitbucket)$/i,
    /^(mysql|postgresql|mongodb|redis|elasticsearch|kafka|rabbitmq|sqlite)$/i,
    /^(http|https|tcp|udp|websocket|graphql|rest|grpc|mqtt)$/i,
    /(framework|library|toolkit|platform|service|database|server|client|protocol|algorithm|technology|software|hardware|system|application|tool|package|module|component|interface|api|sdk)/i,
  ],
  organization: [
    /\b(Inc\.?|Corp\.?|LLC|Ltd\.?|GmbH|SA|AG|PLC|Co\.?|Company|Corporation|Group|Holdings|Partners|Associates|Foundation|Institute|University|College|School|Academy|Hospital|Bank|Agency|Department|Ministry|Commission|Committee|Council|Board|Authority|Office|Bureau|Service|Administration|Organization|Association|Society|Union|Federation|Confederation|Alliance|Coalition|Network|Consortium|Trust|Fund)\b/i,
    /^(Microsoft|Google|Facebook|Meta|Amazon|Apple|Netflix|Tesla|SpaceX|OpenAI|Anthropic|DeepMind|IBM|Oracle|Intel|AMD|NVIDIA|Samsung|Sony|Nintendo|Adobe|Salesforce|Uber|Airbnb|Twitter|X|LinkedIn|TikTok|ByteDance|Alibaba|Tencent|Baidu)/i,
    /^(UN|UNESCO|WHO|IMF|World Bank|NATO|EU|NASA|FDA|CDC|FBI|CIA|NSA|MIT|Harvard|Stanford|Oxford|Cambridge)/i,
  ],
  person: [
    /^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Sir|Dame|Lord|Lady)\s+/i,
    /^[A-Z][a-z]+\s+(([A-Z]\.?\s+)?[A-Z][a-z]+|[A-Z][a-z]+\s+[A-Z][a-z]+)$/,
    /\s+(Jr\.?|Sr\.?|III|IV|V|MD|PhD|Esq\.?)$/i,
    /^[A-Z][a-z]+\s+[A-Z]'[A-Z][a-z]+$/,
    /^[A-Z][a-z]+\s+(van|von|de|di|da|del|della|dos|mac|mc|o'|le|la)\s+[A-Z][a-z]+$/i,
    /(CEO|CTO|CFO|COO|CMO|President|Director|Manager|Engineer|Developer|Designer|Analyst|Scientist|Professor|Doctor|Attorney|Judge|Senator|Representative|Governor|Mayor|Minister|Secretary|Commissioner|Chief|Head|Lead|Principal|Founder|Co-founder|Chairman|Board Member)/i,
  ],
  location: [
    /^(United States|Canada|Mexico|Brazil|Argentina|United Kingdom|France|Germany|Spain|Italy|Russia|China|Japan|India|Australia|South Africa)/i,
    /^(New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Austin|Jacksonville|San Francisco|Seattle|Denver|Boston|Washington|Miami|Atlanta|Portland)/i,
    /^(London|Paris|Berlin|Rome|Madrid|Moscow|Beijing|Tokyo|Mumbai|Sydney|Toronto|Vancouver|Montreal|Mexico City|São Paulo|Buenos Aires)/i,
    /\b(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Plaza|Square|Park|City|Town|Village|County|State|Province|Country|Nation|Continent|Ocean|Sea|River|Lake|Mountain|Valley|Desert|Forest|Island)\b/i,
  ],
  product: [
    /^(iPhone|iPad|MacBook|iMac|Apple Watch|AirPods|Pixel|Galaxy|Surface|Xbox|PlayStation|Switch)/i,
    /\b(Pro|Plus|Max|Mini|Air|Ultra|Lite|Premium|Standard|Basic|Enterprise|Professional|Personal|Home|Business)\b/i,
    /\b(Version|v\d+|\d+\.\d+|\d{4}|Gen \d+|Generation|Edition|Release|Update|Patch|Build)\b/i,
  ],
  concept: [
    /^(Democracy|Capitalism|Socialism|Freedom|Justice|Equality|Liberty|Privacy|Security|Innovation|Sustainability|Diversity|Inclusion|Ethics|Morality|Philosophy|Science|Art|Culture|Education|Health|Wealth|Poverty|War|Peace|Love|Hate|Fear|Hope|Faith|Truth|Knowledge|Wisdom|Power|Authority|Responsibility|Accountability)/i,
    /(methodology|approach|strategy|technique|process|procedure|principle|theory|concept|idea|framework|model|pattern|practice|standard|guideline|policy|rule|regulation|law)/i,
  ],
  event: [
    /^(World War|Civil War|Revolution|Olympics|World Cup|Super Bowl|Conference|Summit|Symposium|Workshop|Seminar|Meeting|Election|Referendum|Festival|Fair|Expo|Exhibition|Show|Concert|Tour)/i,
    /\b(2019|2020|2021|2022|2023|2024|2025|2026)\b/,
    /(January|February|March|April|May|June|July|August|September|October|November|December)/i,
  ],
}

/**
 * Detect entity type based on common patterns
 * @param {string} entityName - Entity name to classify
 * @returns {string} Detected entity type
 */
export function detectEntityType(entityName) {
  if (!entityName || typeof entityName !== 'string') return 'Entity'
  
  const trimmed = entityName.trim()
  
  // Check each category of patterns
  for (const [type, patterns] of Object.entries(ENTITY_TYPE_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(trimmed))) {
      // Capitalize first letter
      return type.charAt(0).toUpperCase() + type.slice(1)
    }
  }
  
  // If it's a single capitalized word, likely a concept or brand
  if (/^[A-Z][a-z]+$/.test(trimmed)) {
    return 'Concept'
  }
  
  // Default fallback
  return 'Entity'
}
