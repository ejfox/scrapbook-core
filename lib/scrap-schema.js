/**
 * Scrap Schema - Single Source of Truth
 *
 * This defines the complete structure of a scrap object across the entire codebase.
 * Import this anywhere you need to work with scraps to ensure consistency.
 */

/**
 * All fields in the scraps table, in their canonical order and with type information
 */
export const SCRAP_FIELDS = [
  // Core identifiers
  { name: 'id', type: 'uuid', required: true, description: 'Primary key UUID' },
  { name: 'scrap_id', type: 'string', description: 'Source-specific identifier (e.g., "pinboard-abc123")' },

  // Source information
  { name: 'source', type: 'string', required: true, description: 'Origin source (pinboard, arena, github, mastodon)' },
  { name: 'type', type: 'string', description: 'Content type (bookmark, post, etc.)' },

  // Basic content
  { name: 'url', type: 'string', description: 'Primary URL' },
  { name: 'title', type: 'string', description: 'Content title' },
  { name: 'content', type: 'text', description: 'Main content body' },
  { name: 'summary', type: 'string', description: 'Human-readable summary (legacy field, use ai_summary)' },

  // Categorization
  { name: 'tags', type: 'array', description: 'User tags from source' },
  { name: 'concept_tags', type: 'array', description: 'AI-extracted concept tags' },

  // Relationships & graph
  { name: 'relationships', type: 'array', description: 'Extracted relationships/entities as graph edges' },
  { name: 'graph_imported', type: 'boolean', default: false, description: 'Whether imported into Neo4j' },

  // Location data
  { name: 'location', type: 'string', description: 'Named location' },
  { name: 'latitude', type: 'number', description: 'Latitude coordinate' },
  { name: 'longitude', type: 'number', description: 'Longitude coordinate' },

  // AI-extracted data
  { name: 'financial_analysis', type: 'json', description: 'AI-extracted financial information' },
  { name: 'extraction_confidence', type: 'number', description: 'Confidence score for AI extractions' },

  // Media
  { name: 'screenshot_url', type: 'string', description: 'Screenshot/preview image URL' },
  { name: 'content_type', type: 'string', description: 'MIME type or content classification' },

  // Metadata
  { name: 'metadata', type: 'json', description: 'Source-specific raw metadata' },
  { name: 'shared', type: 'boolean', description: 'Public/private flag' },
  { name: 'published_at', type: 'timestamp', description: 'Original publication timestamp' },

  // Processing state
  { name: 'processing_instance_id', type: 'string', description: 'Which processing instance handled this' },
  { name: 'processing_started_at', type: 'timestamp', description: 'When processing began' },

  // Timestamps
  { name: 'created_at', type: 'timestamp', required: true, description: 'When record was created' },
  { name: 'updated_at', type: 'timestamp', required: true, description: 'When record was last updated' },

  // Embeddings (vector data)
  { name: 'embedding', type: 'vector', description: 'Primary text embedding vector' },
  { name: 'embedding_nomic', type: 'vector', description: 'Nomic text embedding vector' },
  { name: 'image_embedding', type: 'vector', description: 'Image/screenshot embedding vector' },
]

/**
 * Fields that are AI-extracted and might not be present on initial save
 */
export const AI_EXTRACTED_FIELDS = [
  'summary',
  'concept_tags',
  'relationships',
  'location',
  'financial_analysis',
  'extraction_confidence',
  'screenshot_url',
]

/**
 * Fields that are required for a valid scrap
 */
export const REQUIRED_FIELDS = SCRAP_FIELDS
  .filter(f => f.required)
  .map(f => f.name)

/**
 * Get field metadata by name
 */
export function getFieldMeta(fieldName) {
  return SCRAP_FIELDS.find(f => f.name === fieldName)
}

/**
 * Get all field names as an array
 */
export function getFieldNames() {
  return SCRAP_FIELDS.map(f => f.name)
}

/**
 * Check if a field is AI-extracted
 */
export function isAIField(fieldName) {
  return AI_EXTRACTED_FIELDS.includes(fieldName)
}

/**
 * Create an empty scrap object with all fields set to null/default values
 */
export function createEmptyScrap(overrides = {}) {
  const scrap = {}

  SCRAP_FIELDS.forEach(field => {
    if (field.default !== undefined) {
      scrap[field.name] = field.default
    } else {
      scrap[field.name] = null
    }
  })

  return { ...scrap, ...overrides }
}

/**
 * Validate a scrap object has all required fields
 */
export function validateScrap(scrap) {
  const errors = []

  REQUIRED_FIELDS.forEach(fieldName => {
    if (!scrap[fieldName]) {
      errors.push(`Missing required field: ${fieldName}`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Calculate completeness percentage of a scrap
 * (what percentage of AI fields are filled)
 */
export function calculateCompleteness(scrap) {
  const filledCount = AI_EXTRACTED_FIELDS.filter(fieldName => {
    const value = scrap[fieldName]
    if (Array.isArray(value)) return value.length > 0
    return !!value
  }).length

  return Math.round((filledCount / AI_EXTRACTED_FIELDS.length) * 100)
}

export default {
  SCRAP_FIELDS,
  AI_EXTRACTED_FIELDS,
  REQUIRED_FIELDS,
  getFieldMeta,
  getFieldNames,
  isAIField,
  createEmptyScrap,
  validateScrap,
  calculateCompleteness,
}
