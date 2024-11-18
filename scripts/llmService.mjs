import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Default model configuration
const DEFAULT_MODEL = 'anthropic/claude-3-sonnet-20240229';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

const service = {
  enabled: !!process.env.OPENROUTER_API_KEY,
  
  async completion({ prompt, temperature = 0.7, maxTokens = 1000, model = DEFAULT_MODEL }) {
    if (!this.enabled) {
      throw new Error('OpenRouter API key not configured - please set OPENROUTER_API_KEY');
    }

    try {
      const response = await axios.post(
        `${OPENROUTER_API_URL}/chat/completions`,
        {
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
            'X-Title': 'Scrapbook Core'
          }
        }
      );
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('OpenRouter API error:', error.response?.data || error.message);
      throw new Error(`OpenRouter API error: ${error.message}`);
    }
  },

  // Add embedding support
  async embedding(text, model = 'openai/text-embedding-3-small') {
    if (!this.enabled) {
      return null;
    }

    try {
      const response = await axios.post(
        `${OPENROUTER_API_URL}/embeddings`,
        {
          model: model,
          input: text
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
            'X-Title': 'Scrapbook Core'
          }
        }
      );
      return response.data.data[0].embedding;
    } catch (error) {
      console.error('OpenRouter embedding error:', error.response?.data || error.message);
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