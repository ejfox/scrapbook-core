import CryptoJS from "crypto-js";
import { md5 } from "js-md5";
import cheerio from "cheerio";
import puppeteer from "puppeteer-core"; // Using puppeteer-core
import llamaTokenizer from "llama-tokenizer-js";
import dotenv from "dotenv";
import os from "os";
import { execSync } from "child_process";
import crypto from "crypto";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "production";

// Dynamically determine Chrome executable path based on environment
async function getChromeExecutablePath() {
  if (os.platform() === "darwin") {
    // macOS
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else if (os.platform() === "linux") {
    // Linux (Docker environment)
    try {
      const chromiumPath = execSync("which chromium-browser || which chromium")
        .toString()
        .trim();
      return chromiumPath;
    } catch (error) {
      console.error("Chromium not found on Linux, ensure it is installed.");
      return null;
    }
  } else {
    throw new Error(`Unsupported platform: ${os.platform()}`);
  }
}

// Fetch page content using Puppeteer with dynamic Chrome path
export async function fetchPageContent(url) {
  const ALLOWED_TEXT_ELEMENTS =
    "p, h1, h2, h3, h4, h5, h6, a, td, th, tr, pre, code, blockquote, li, ol, ul, table, caption";

  const chromePath = await getChromeExecutablePath();
  if (!chromePath) {
    return `Error: No valid Chrome executable path found for platform ${os.platform()}`;
  }

  try {
    const browser = await puppeteer.launch({
      executablePath: NODE_ENV !== "development" ? chromePath : undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
      headless: "new",
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const pageTitle = await page.title();
    const content = await page.content();
    const $ = cheerio.load(content);

    const allowedContent = $(ALLOWED_TEXT_ELEMENTS)
      .map((index, element) => {
        return $(element).text();
      })
      .get()
      .join(" ");

    await browser.close();

    return `#${pageTitle}\n##${url}\n${allowedContent}`;
  } catch (error) {
    console.error(`Error processing ${url}:`, error);
    return `Error processing ${url}: ${error.message}`;
  }
}

export const getHumanReadableContent = (scrap) => {
  if (scrap.pull_request) {
    return `User created a new pull request: ${scrap.title}`;
  } else if (scrap.issue) {
    return `User created a new issue: ${scrap.title}`;
  } else if (scrap.repository) {
    return `User created a new repository: ${scrap.name}`;
  } else if (scrap.gist) {
    return `User created a new gist: ${scrap.description || "No description"}`;
  } else if (scrap.release) {
    return `User created a new release: ${scrap.name}`;
  } else if (scrap.starred) {
    return `User starred a repository: ${scrap.full_name}`;
  } else {
    return `Unknown action`;
  }
};

export function generateShortId(uuid) {
  // Take first 8 characters of UUID and ensure they're valid hex
  return uuid.substring(0, 8).replace(/[^0-9a-f]/g, "0");
}

export function generateScrapId(source, uniqueIdentifier) {
  // Generate proper UUID v4
  const uuid = crypto.randomUUID();
  return uuid;
}

export function uuidToScrap(uuid, scrapArray) {
  if (!scrapArray?.length || !uuid) {
    console.error("Invalid input", uuid);
    return null;
  }

  const scrap = scrapArray.find(
    (scrap) => scrap.id === uuid || scrap.metadata?.shortId === uuid
  );

  if (!scrap) {
    console.error("No scrap found for the given UUID", uuid);
    return null;
  }

  return scrap;
}

function articleExists(article) {
  if (!article) return false;
  if (!article.excerpt) return false;
  if (!article.excerpt.children) return false;
  if (!article.excerpt.children.length) return false;
  return true;
}

export function countWords(article) {
  if (!articleExists(article)) return 0;
  if (!article.excerpt.children) return 0;
  const words = article.excerpt.children
    .filter(
      (node) =>
        node.tag === "p" ||
        node.tag === "h1" ||
        node.tag === "h2" ||
        node.tag === "h3" ||
        node.tag === "h4" ||
        node.tag === "blockquote" ||
        node.tag === "li" ||
        node.tag === "ol" ||
        node.tag === "ul"
    )
    .map((node) => node.children)
    .flat()
    .filter((node) => node.type === "text")
    .map((node) => node.value)
    .join(" ")
    .split(" ")
    .filter((word) => word.length > 0);
  return words.length;
}

export function countPhotos(article) {
  const photos = article.body.children
    .filter((node) => node.tag === "img")
    .map((node) => node.attrs)
    .flat();

  return photos.length;
}

export function extractPhotos(article) {
  const photos = article.body.children
    .filter((node) => node.tag === "img")
    .flat();

  return photos;
}

export function extractFirstPhoto(article) {
  const photos = extractPhotos(article);
  if (photos.length) return photos[0];
  return null;
}

export function countLinks(article) {
  if (!articleExists(article)) return 0;
  if (!article.excerpt.children) return 0;
  const links = article.excerpt.children
    .filter(
      (node) =>
        node.tag === "p" ||
        node.tag === "h1" ||
        node.tag === "h2" ||
        node.tag === "h3" ||
        node.tag === "h4" ||
        node.tag === "blockquote"
    )
    .map((node) => node.children)
    .flat()
    .filter((node) => node.tag === "a")
    .map((node) => node.attrs)
    .flat();
  return links.length;
}

export function filterStrongTags(article) {
  if (!articleExists(article)) return [];
  const strongTags = article.body.children
    .filter(
      (node) =>
        node.tag === "p" ||
        node.tag === "h1" ||
        node.tag === "h2" ||
        node.tag === "h3" ||
        node.tag === "h4" ||
        node.tag === "blockquote"
    )
    .map((node) => node.children)
    .flat()
    .filter((node) => node.tag === "strong")
    .map((node) => node.children)
    .flat()
    .filter((node) => node.type === "text")
    .map((node) => node.value)
    .filter((word) => word.length > 0);
  return strongTags;
}

export function isValidHttpUrl(string) {
  let url;

  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }

  return url.protocol === "http:" || url.protocol === "https:";
}

export function generatePassword(titleSlug) {
  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const title = titleSlug;
  const rawPassword = `${year}-${month}-${day}-${title}`;
  const hash = md5(rawPassword);
  const password = hash.slice(0, 8) + hash.slice(-8);
  return password;
}

// Function to break content into chunks
export function breakContentIntoChunks(content, chunkSizeTokens = 6144) {
  if (!content) return [];

  // Ensure content is a string and handle null/undefined
  const text = String(content || "");

  // Split into sentences more reliably
  const sentences = text
    .replace(/([.!?])\s+/g, "$1\n")
    .split("\n")
    .filter(Boolean);

  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    const sentenceTokenSize = llamaTokenizer.encode(
      currentChunk + sentence
    ).length;

    if (sentenceTokenSize > chunkSizeTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }

    currentChunk += sentence + " ";
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Splits content into chunks of a specified maximum size.
 * @param {string} content - The text content to be split into chunks.
 * @param {Object} options - Configuration options.
 * @param {number} [options.chunkMaxChars=16384] - Maximum number of characters per chunk.
 * @returns {string[]} An array of content chunks.
 */
export function contentToChunks(content, options = {}) {
  const { chunkMaxChars = 16384 } = options;
  const chunks = [];
  let currentChunk = "";

  const paragraphs = content.split("\n");

  const addChunk = () => {
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
  };

  const splitLongParagraph = (paragraph) => {
    const words = paragraph.split(" ");
    for (const word of words) {
      if (currentChunk.length + word.length > chunkMaxChars) {
        addChunk();
      }
      currentChunk += (currentChunk ? " " : "") + word;
    }
    addChunk();
  };

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= chunkMaxChars) {
      currentChunk += (currentChunk ? "\n" : "") + paragraph;
    } else {
      addChunk();
      if (paragraph.length <= chunkMaxChars) {
        currentChunk = paragraph;
      } else {
        splitLongParagraph(paragraph);
      }
    }
  }

  addChunk();

  console.log(`Chunks: ${chunks.length}`);
  return chunks;
}
