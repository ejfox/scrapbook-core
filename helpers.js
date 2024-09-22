import CryptoJS from "crypto-js";
import { md5 } from "js-md5";
import cheerio from "cheerio";
import puppeteer from "puppeteer";
import llamaTokenizer from "llama-tokenizer-js";
import dotenv from "dotenv";
dotenv.config();

const NODE_ENV = process.env.NODE_ENV;
const CHROME_EXECUTABLE_PATH = "/usr/bin/google-chrome";

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

export function generateShortId(data, length = 8) {
  const hash = CryptoJS.SHA256(data);
  const base64 = CryptoJS.enc.Base64.stringify(hash)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64.substring(0, length);
}
export function scrapToUUID(scrapIdString) {
  return generateShortId(scrapIdString);
}

export function uuidToScrap(uuid, scrapArray) {
  if (!scrapArray || !scrapArray.length || !uuid) {
    console.error("Invalid input", uuid);
    return null;
  }

  const scrap = scrapArray.find((scrap) => scrap.scrap_id === uuid);

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
  // console.log('Counting words in', article)
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
  // look inside all paragraphs and headings for links
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
  // look 3 levels deep in article.body.children for strong tags
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
  // start with todays date in YYYY-MM-DD format
  const date = new Date();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // add the title slug
  const title = titleSlug;

  const rawPassword = `${year}-${month}-${day}-${title}`;
  // make a hash of the raw password
  const hash = md5(rawPassword);
  // take the first 8 characters of the hash and the last 8 characters of the hash
  const password = hash.slice(0, 8) + hash.slice(-8);
  return password;
}

export async function fetchPageContent(url) {
  const ALLOWED_TEXT_ELEMENTS =
    "p, h1, h2, h3, h4, h5, h6, a, td, th, tr, pre, code, blockquote, li, ol, ul, table, caption";

  // set up puppeteer
  try {
    const browser = await puppeteer.launch({
      executablePath:
        NODE_ENV !== "development"
          ? CHROME_EXECUTABLE_PATH || "/usr/bin/google-chrome"
          : undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
      // @ts-ignore
      headless: "new",
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // wait a second for the page to load

    const pageTitle = await page.title();

    const content = await page.content();

    // parse out the allowed element content with cheerio
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

// this breaks the large content into smaller chunks
export function breakContentIntoChunks(content, chunkSizeTokens) {
  // Split the content into sentences using a regular expression
  // The regular expression matches common sentence delimiters: periods, exclamation marks, and question marks
  // It accounts for common abbreviations and edge cases to avoid splitting on false sentence boundaries

  if (!content) return [];
  const sentences = content.match(/[^.!?]+[.!?]+/g);

  // Initialize an empty array to store the chunks
  const chunks = [];

  // Initialize a variable to keep track of the current chunk being built
  let currentChunk = "";

  // Iterate over each sentence
  for (const sentence of sentences) {
    const sentenceTokenSize = llamaTokenizer.encode(
      currentChunk + sentence
    ).length;

    // Check if adding the current sentence to the current chunk would exceed the chunk size limit
    if (sentenceTokenSize > chunkSizeTokens) {
      // If the chunk size limit is exceeded, add the current chunk to the chunks array
      chunks.push(currentChunk.trim());

      // Reset the current chunk to start building a new chunk
      currentChunk = "";
    }

    // Append the current sentence to the current chunk
    currentChunk += sentence + " ";
  }

  // log the chunk sizes in tokens
  chunks.forEach((chunk, index) => {
    console.log(`Chunk ${index} size: ${llamaTokenizer.encode(chunk).length}`);
  });

  // After processing all sentences, add the remaining current chunk to the chunks array
  if (currentChunk.trim() !== "") {
    chunks.push(currentChunk.trim());

    // Log the size of the last chunk
    console.log(`Chunk size: ${llamaTokenizer.encode(currentChunk).length}`);
  }

  // Return the array of chunks
  return chunks;
}

/**
 * Splits content into chunks of a specified maximum size.
 * @param {string} content - The text content to be split into chunks.
 * @param {Object} options - Configuration options.
 * @param {number} [options.chunkMaxChars=2048] - Maximum number of characters per chunk.
 * @returns {string[]} An array of content chunks.
 */
export function contentToChunks(content, options = {}) {
  const { chunkMaxChars = 16384 } = options;
  const chunks = [];
  let currentChunk = "";

  // Split the content into paragraphs
  const paragraphs = content.split("\n");

  /**
   * Helper function to add the current chunk to the chunks array and reset it.
   */
  const addChunk = () => {
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
  };

  /**
   * Helper function to split a long paragraph into smaller chunks.
   * @param {string} paragraph - The paragraph to split.
   */
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

  // Process each paragraph
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= chunkMaxChars) {
      // If the paragraph fits in the current chunk, add it
      currentChunk += (currentChunk ? "\n" : "") + paragraph;
    } else {
      // If it doesn't fit, add the current chunk and process the paragraph
      addChunk();
      if (paragraph.length <= chunkMaxChars) {
        currentChunk = paragraph;
      } else {
        splitLongParagraph(paragraph);
      }
    }
  }

  // Add any remaining content in the current chunk
  addChunk();

  console.log(`Chunks: ${chunks.length}`);
  return chunks;
}
