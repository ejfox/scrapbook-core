import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let config = null;

export function loadConfig() {
  if (config) return config;
  
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
    
    validateConfig(config);
    return config;
  } catch (error) {
    console.error('Failed to load configuration:', error);
    throw new Error(`Configuration loading failed: ${error.message}`);
  }
}

function validateConfig(config) {
  const requiredSections = [
    'models',
    'processing', 
    'rateLimits',
    'api',
    'media',
    'embedding',
    'system'
  ];
  
  for (const section of requiredSections) {
    if (!config[section]) {
      throw new Error(`Missing required configuration section: ${section}`);
    }
  }
  
  if (!config.models.tasks?.contentAnalysis) {
    throw new Error('Missing contentAnalysis model configuration');
  }
  
  if (!config.models.tasks?.textEmbedding) {
    throw new Error('Missing textEmbedding model configuration');
  }
}

export function getModelForTask(task) {
  const config = loadConfig();
  const model = config.models.tasks[task];
  
  if (!model) {
    console.warn(`No model configured for task: ${task}, using contentAnalysis`);
    return config.models.tasks.contentAnalysis;
  }
  
  return model;
}

export function getFallbackModels() {
  const config = loadConfig();
  return config.models.fallbacks;
}

export function getModelConfig(type = 'completion') {
  const config = loadConfig();
  
  // Map legacy types to task-based assignments
  switch (type) {
    case 'completion':
      return config.models.tasks.contentAnalysis;
    case 'textEmbedding':
      return config.models.tasks.textEmbedding;
    case 'imageEmbedding':
      return config.models.tasks.imageEmbedding;
    default:
      return config.models.tasks.contentAnalysis;
  }
}

export function getRateLimitConfig(service) {
  const config = loadConfig();
  return config.rateLimits[service] || config.rateLimits.general;
}

export function getBatchSizeConfig(type = 'dataProcessing') {
  const config = loadConfig();
  return config.processing.batchSizes[type] || config.processing.batchSizes.dataProcessing;
}

export function getTimeoutConfig(type) {
  const config = loadConfig();
  return config.processing.timeouts[type];
}

export function getRetryConfig(type = 'default') {
  const config = loadConfig();
  return config.processing.retries[type] || config.processing.retries.default;
}

export function getApiEndpoint(service) {
  const config = loadConfig();
  return config.api.endpoints[service];
}

export function getMediaConfig(type) {
  const config = loadConfig();
  return config.media[type];
}

export function getEmbeddingConfig() {
  const config = loadConfig();
  return config.embedding;
}

export function getSystemConfig() {
  const config = loadConfig();
  return config.system;
}

export default {
  loadConfig,
  getModelConfig,
  getModelForTask,
  getFallbackModels,
  getRateLimitConfig,
  getBatchSizeConfig,
  getTimeoutConfig,
  getRetryConfig,
  getApiEndpoint,
  getMediaConfig,
  getEmbeddingConfig,
  getSystemConfig
};