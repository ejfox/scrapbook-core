import CryptoJS from "crypto-js";
import { md5 } from "js-md5";
import cheerio from "cheerio";
import puppeteer from "puppeteer";
import llamaTokenizer from "llama-tokenizer-js";

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
    "p, h1, h2, h3, h4, h5, h6, a, td, th, tr, pre, code, blockquote";
  // set up puppeteer

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // wait a second for the page to load

  const pageTitle = await page.title();

  const content = await page.content();
  await browser.close();

  // parse out the allowed element content with cheerio
  const $ = cheerio.load(content);
  const allowedContent = $(ALLOWED_TEXT_ELEMENTS)
    .map((index, element) => {
      return $(element).text();
    })
    .get()
    .join(" ");

  return `#${pageTitle}\n##${url}\n${allowedContent}`;
}

// this breaks the large content into smaller chunks
export function breakContentIntoChunks(content, chunkSizeTokens) {
  // Split the content into sentences using a regular expression
  // The regular expression matches common sentence delimiters: periods, exclamation marks, and question marks
  // It accounts for common abbreviations and edge cases to avoid splitting on false sentence boundaries
  const sentences = content.match(/[^.!?]+[.!?]+/g);

  // Initialize an empty array to store the chunks
  const chunks = [];

  // Initialize a variable to keep track of the current chunk being built
  let currentChunk = "";

  // Iterate over each sentence
  for (const sentence of sentences) {
    // Calculate the token count of the current sentence
    const sentenceTokenCount = llamaTokenizer.encode(sentence).length;

    // Check if adding the current sentence to the current chunk would exceed the chunk size limit
    if (
      llamaTokenizer.encode(currentChunk + sentence).length > chunkSizeTokens
    ) {
      // If the chunk size limit is exceeded, add the current chunk to the chunks array
      chunks.push(currentChunk.trim());

      // Reset the current chunk to start building a new chunk
      currentChunk = "";
    }

    // Append the current sentence to the current chunk
    currentChunk += sentence + " ";
  }

  // After processing all sentences, add the remaining current chunk to the chunks array
  if (currentChunk.trim() !== "") {
    chunks.push(currentChunk.trim());
  }

  // Return the array of chunks
  return chunks;
}
