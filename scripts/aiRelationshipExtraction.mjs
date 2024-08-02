import axios from "axios";
import Bottleneck from "bottleneck";
import OpenAI from "openai";
import dotenv from "dotenv";
import { contentToChunks } from "../helpers.js";
import winston from "winston";

dotenv.config();

// Setup Winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "relationship_extraction.log" }),
  ],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_RELATIONSHIPS = 12;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// OLD, a bit too strict?
// const relationshipRegex =
//   /^\s*\[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\]\s*-\s*\[:([a-zA-Z0-9_]+)\]\s*->\s*\[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\]\s*$/;

// NEW, more flexible
const relationshipRegex =
  /^\s*\[([^:\]]+):\s*([^\]]+)\]\s*-\s*\[:([^\]]+)\]\s*->\s*\[([^:\]]+):\s*([^\]]+)\]\s*$/;
// matches: [sourceType:sourceName] -[:relationshipType]-> [targetType:targetName]

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

function chooseLLMService() {
  return process.env.USE_OPENAI === "true" ? "openai" : "local";
}

/**
 * Extract relationships from content
 * @param {string} content - The content to extract relationships from (can be summary or raw text)
 * @param {object} options - Additional options
 * @param {boolean} options.isRawText - Whether the content is raw text that needs chunking
 * @returns {Promise<{relationships: Array}>} - Extracted relationships
 */
export async function extractRelationships(content, options = {}) {
  logger.info("Starting relationship extraction process");

  let chunks;
  if (options.isRawText) {
    chunks = contentToChunks(content);
    logger.info(`Raw content split into ${chunks.length} chunks`);
  } else {
    chunks = [content]; // If it's already a summary, treat it as a single chunk
    logger.info("Processing pre-summarized content");
  }

  const relationshipsData = [];
  const nodes = new Set();

  for (let i = 0; i < chunks.length; i++) {
    logger.info(`Processing chunk ${i + 1}/${chunks.length}`);
    const chunkRelationships = await limiter.schedule(() =>
      extractRelationshipsFromChunk(chunks[i])
    );

    for (const relationship of chunkRelationships) {
      const { source, target, type } = relationship;
      nodes.add(JSON.stringify(source));
      nodes.add(JSON.stringify(target));
      relationshipsData.push(relationship);

      logger.info(
        `Relationship found: ${source.name} (${source.type}) -[${type}]-> ${target.name} (${target.type})`
      );
    }
  }

  const uniqueNodes = Array.from(nodes).map((nodeString) =>
    JSON.parse(nodeString)
  );
  logger.info(
    `Extracted ${uniqueNodes.length} unique nodes and ${relationshipsData.length} relationships`
  );

  return { relationships: relationshipsData };
}

async function extractRelationshipsFromChunk(chunk, retryCount = 0) {
  const llmService = chooseLLMService();
  logger.info(`Using ${llmService} service for relationship extraction`);

  const messages = [
    {
      role: "system",
      content: `Extract entities and identify relationship types from the given text. Limit to ${MAX_RELATIONSHIPS} relationships. Focus on connections between technologies, people, organizations, and other relevant entities. Output each relationship on a new line using this format: [entity1_type:entity1_name] -[:RELATIONSHIP_TYPE]-> [entity2_type:entity2_name]`,
    },
    // give an example exchange
    {
      role: "user",
      content: `Can you give me a few example relationships?`,
    },
    {
      role: "assistant",
      content: `[Person:Stewart Brand] -[:CreatedBy]-> [Publication:Whole Earth Catalog]
[Person:Steve Jobs] -[:InfluencedBy]-> [Publication:Whole Earth Catalog]`,
    },
    {
      role: "user",
      content: `Perfect!
      
Use ONLY these entity types (exactly as written, with no spaces):
Person, Organization, Event, Product, Technology, Startup, ResearchGroup, Investor, Conference, Publication, GovernmentAgency, NonProfitOrganization, EducationalInstitution, Concept, Framework, IndustryGroup, Influencer, Platform, Standard, Protocol, FundingRound, Location, JobTitle, Award, MediaContent, Service, MedicalCondition, ChemicalSubstance, Device, Software, Sport, Animal, Plant, ArtMovement, HistoricalPeriod, PoliticalMovement, CulturalMovement

And ONLY these relationship types (exactly as written, with no spaces):
CreatedBy, InvestedIn, CollaboratedWith, ParticipatedIn, PublishedBy, SupportedBy, ImplementedBy, OccurredAt, InfluencedBy, UsedIn, DependentOn, CompatibleWith, TestedBy, DocumentedBy, MaintainedBy

Extract relationships from the following text:

${chunk}`,
    },
  ];

  try {
    let responseMsg;
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages,
        temperature: 0.7,
        max_tokens: 256,
      });
      responseMsg = response.choices[0].message.content;
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.7,
        max_tokens: 256,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      responseMsg = response.data.choices[0].message.content;
    }

    const relationships = responseMsg
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(parseRelationship)
      .filter(Boolean);

    if (relationships.length === 0) {
      logger.warn(`No valid relationships found in response: ${responseMsg}`);
      if (retryCount < MAX_RETRIES) {
        logger.info(
          `Retrying extraction (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return await extractRelationshipsFromChunk(chunk, retryCount + 1);
      } else {
        logger.error(
          `Max retries reached. Unable to extract valid relationships.`
        );
        return [];
      }
    }

    logger.info(
      `Successfully extracted ${relationships.length} relationships from chunk`
    );
    return relationships;
  } catch (error) {
    logger.error(`Error in ${llmService} service: ${error.message}`);
    if (retryCount < MAX_RETRIES) {
      logger.info(
        `Retrying due to error (attempt ${retryCount + 1}/${MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return await extractRelationshipsFromChunk(chunk, retryCount + 1);
    } else {
      throw new Error(
        `Failed to extract relationships after ${MAX_RETRIES} attempts: ${error.message}`
      );
    }
  }
}

function parseRelationship(relationshipString) {
  const match = relationshipString.match(relationshipRegex);
  if (match) {
    const [
      _,
      sourceType,
      sourceName,
      relationshipType,
      targetType,
      targetName,
    ] = match;
    return {
      source: { type: sourceType.trim(), name: sourceName.trim() },
      target: { type: targetType.trim(), name: targetName.trim() },
      type: relationshipType.trim(),
    };
  }
  logger.warn(`Invalid relationship format: ${relationshipString}`);
  return null;
}
