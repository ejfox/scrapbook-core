import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// API configurations
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1';

// Model configurations
export const MODELS = {
  // Claude models for completion
  CLAUDE_INSTANT: 'anthropic/claude-instant-1.2',
  CLAUDE_2: 'anthropic/claude-2.1',
  CLAUDE_3_OPUS: 'anthropic/claude-3-opus-20240229',
  CLAUDE_3_SONNET: 'anthropic/claude-3-sonnet-20240229',
  
  // GPT models for completion
  GPT_3_5_TURBO: 'openai/gpt-3.5-turbo',
  GPT_4: 'openai/gpt-4',
  GPT_4_TURBO: 'openai/gpt-4-turbo-preview',
  
  // Nomic embedding models
  NOMIC_EMBED_TEXT: 'nomic-embed-text-v1',
  NOMIC_EMBED_IMAGE: 'nomic-embed-image-v1'
};

// Default model configuration
const DEFAULT_COMPLETION_MODEL = MODELS.CLAUDE_3_SONNET;
const DEFAULT_TEXT_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_TEXT;
const DEFAULT_IMAGE_EMBEDDING_MODEL = MODELS.NOMIC_EMBED_IMAGE;

const service = {
  enabled: !!process.env.OPENROUTER_API_KEY,
  
  async completion({ prompt, temperature = 0.7, maxTokens = 1000, model = DEFAULT_COMPLETION_MODEL }) {
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

  async embedding(input, options = {}) {
    if (!process.env.NOMIC_API_KEY) {
      console.warn('Nomic API key not configured - please set NOMIC_API_KEY');
      return null;
    }

    const { type = 'text', model } = options;
    const defaultModel = type === 'image' ? DEFAULT_IMAGE_EMBEDDING_MODEL : DEFAULT_TEXT_EMBEDDING_MODEL;
    const endpoint = type === 'image' ? 'embedding/image' : 'embedding/text';

    try {
      const payload = type === 'image' 
        ? {
            model: model || defaultModel,
            images: Array.isArray(input) ? input : [input] // Base64 encoded images
          }
        : {
            model: model || defaultModel,
            texts: Array.isArray(input) ? input : [input]
          };

      const response = await axios.post(
        `${NOMIC_API_URL}/${endpoint}`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return Array.isArray(input) ? response.data.embeddings : response.data.embeddings[0];
    } catch (error) {
      console.error('Nomic embedding error:', error.response?.data || error.message);
      return null;
    }
  }
};

export async function completion(prompt, options = {}) {
  return service.completion({ prompt, ...options });
}

export async function generateEmbedding(input, options = {}) {
  return service.embedding(input, options);
}

// Helper function to generate image embedding
export async function generateImageEmbedding(imageBase64) {
  return service.embedding(imageBase64, { type: 'image' });
} 