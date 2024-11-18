import dotenv from 'dotenv';
import OpenRouter from 'openrouter';

dotenv.config();

// Initialize OpenRouter client
const openRouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Default model configuration
const DEFAULT_MODEL = 'anthropic/claude-3-sonnet-20240229';

const service = {
  enabled: !!process.env.OPENROUTER_API_KEY,
  client: openRouter,
  async completion({ prompt, temperature = 0.7, maxTokens = 1000, model = DEFAULT_MODEL }) {
    if (!this.enabled) {
      throw new Error('OpenRouter API key not configured - please set OPENROUTER_API_KEY');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      });
      return response.choices[0].message.content;
    } catch (error) {
      console.error('OpenRouter API error:', error);
      throw new Error(`OpenRouter API error: ${error.message}`);
    }
  },

  // Add embedding support
  async embedding(text, model = 'openai/text-embedding-3-small') {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await this.client.embeddings.create({
        model: model,
        input: text
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('OpenRouter embedding error:', error);
      return null;
    }
  }
};

export async function completion(prompt, options = {}) {
  return service.completion({ prompt, ...options });
}

export async function generateEmbedding(text, model) {
  return service.embedding(text, model);
} 