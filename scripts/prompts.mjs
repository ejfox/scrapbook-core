// Central location for all AI prompts used in the application
export const PROMPTS = {
  LOCATION: {
    EXTRACT: `Analyze the text and extract locations in this format:
Primary: [Most significant/central location in City, State/Region, Country format]
Others: [List other mentioned locations in same format]

Choose the primary location based on:
1. Main focus of the content
2. First significant location mentioned
3. Location with most context/detail

Example output:
Primary: San Francisco, California, USA
Others:
- New York City, New York, USA
- London, England, UK`,
  },

  RELATIONSHIPS: {
    EXTRACT: `Extract relationships from this content using Cypher-style notation.

Format each relationship as:
[EntityA]-[RELATIONSHIP]->[EntityB]

Examples:
[Vue.js]-[INTRODUCES]->[Composition API]
[TypeScript]-[ENHANCES]->[JavaScript]
[React]-[COMPETES_WITH]->[Vue.js]

Rules:
1. Use UPPERCASE for relationship types
2. Use clear, specific relationship verbs
3. One relationship per line
4. No explanations or comments
5. Square brackets are required
6. Arrow is exactly: ->

Return one relationship per line. If no relationships found, return empty.`,
  },

  SUMMARIZATION: {
    CONTENT: `When analyzing content, your goal is to:
- Extract key information into standalone bullet points
- Preserve technical details, URLs, and specific references
- Focus on unique or significant points
- Keep each point self-contained
- Be concise but precise
- Include verbatim quotes when relevant

Format as a list of clear, independent facts.`,

    TAGS: `You are tagging content. Choose 2-3 most relevant tags from this list:
{CORE_TAGS}

Content to tag:
{CONTENT}

Return only valid tags from the list above, one per line, no explanations.`
  },

  GITHUB: {
    ACTIVITY: `Analyze this GitHub activity and extract:
- Project context
- Technical details
- Key changes/features
- Impact/significance
- Related technologies

Format as a concise summary.`,
  },

  MASTODON: {
    TAGS: `Extract relevant tags from this Mastodon post. Consider:
- Explicit hashtags
- Key topics
- Technologies
- Concepts
- Names/organizations

Return as a JSON array of strings.`,
  }
}; 