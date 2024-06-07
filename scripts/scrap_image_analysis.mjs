import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import Bottleneck from "bottleneck";
import dotenv from "dotenv";
import getColors from "get-image-colors";
// import chroma js
import chroma from "chroma-js";
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Limiter for API requests
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 1000,
});

/**
 * Fetches a batch of scraps from the Supabase database.
 * @param {number} page - The page number of the batch.
 * @param {number} pageSize - The number of scraps per page.
 * @returns {Promise<Array>} - A promise that resolves to an array of scraps.
 */
async function fetchScraps(page, pageSize) {
  const { data, error } = await supabase
    .from("scraps")
    .select("*")
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (error) {
    console.error("Error fetching scraps:", error);
    return [];
  }

  return data;
}

/**
 * Updates the image analysis and embedding data for a scrap in the Supabase database.
 * @param {string} scrapId - The ID of the scrap to update.
 * @param {Object} imageAnalysis - The image analysis data to update.
 * @param {Array} imageEmbedding - The image embedding data to update.
 * @returns {Promise<void>} - A promise that resolves when the update is complete.
 */
async function updateScrapImageAnalysis(
  scrapId,
  imageAnalysis,
  imageEmbedding
) {
  const { data: scrapData, error: scrapError } = await supabase
    .from("scraps")
    .select("metadata")

    .eq("scrap_id", scrapId);

  if (scrapError) {
    console.error(`Error fetching scrap ${scrapId}:`, scrapError);
    return;
  }

  const currentMetadata = scrapData[0].metadata;

  const { data, error } = await supabase
    .from("scraps")
    .update({
      embedding: imageEmbedding,
      metadata: {
        ...currentMetadata,
        image_analysis: imageAnalysis,
      },
    })
    .eq("scrap_id", scrapId);

  if (error) {
    console.error(`Error updating scrap ${scrapId}:`, error);
  }
}

/**
 * Analyzes an image URL to extract color-related data using the get-image-colors package.
 * @param {string} imageUrl - The URL of the image to analyze.
 * @returns {Promise<Object|null>} - A promise that resolves to an object containing color analysis data, or null if an error occurs.
 */
async function analyzeImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error("Error fetching image:", response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(buffer);

    const colors = await getColors(imageBuffer, { type: "image/png" });

    // const lightness = colors[0].get("lab.l");

    // const dominantColor = colors[0].rgba();
    // use chroma js to get the average color of the image
    const dominantColor = chroma.average(colors, "lch").hex();
    const lightness = chroma(dominantColor).get("lab.l");
    const temperature = chroma(dominantColor).temperature();

    return {
      palette: colors.map((color) => color.hex()),
      dominant_color: dominantColor,
      lightness: lightness,
      temperature: temperature,
    };
  } catch (error) {
    console.error("Error analyzing image:", error);
    return null;
  }
}

/**
 * Generates an image embedding using the Nomic API.
 * @param {string} imageUrl - The URL of the image to generate an embedding for.
 * @returns {Promise<Array|null>} - A promise that resolves to an array representing the image embedding, or null if an error occurs.
 */
async function generateImageEmbedding(imageUrl) {
  console.log("Generating image embedding for:", imageUrl);

  // const b64 = await toDataURL_node(imageUrl).catch(console.error);

  // async function toDataURL_node(url) {
  //   try {
  //     const response = await fetch(url);
  //     const contentType = response.headers.get("Content-Type");
  //     const buffer = await response.buffer();
  //     return "data:" + contentType + ";base64," + buffer.toString("base64");
  //   } catch (error) {
  //     console.error("Error converting image to base64:", error);
  //     return null;
  //   }
  // }

  try {
    const response = await axios.post(
      "https://api-atlas.nomic.ai/v1/embedding/image",
      {
        model: "nomic-embed-vision-v1.5",
        // images: b64,
        images: imageUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (response.data.embeddings && response.data.embeddings.length > 0) {
      return response.data.embeddings[0];
    } else {
      console.error("No embedding returned for image:", imageUrl);
      return null;
    }
  } catch (error) {
    console.error("Error generating image embedding:", error);
    return null;
  }
}

/**
 * Processes a batch of scraps by analyzing images and generating embeddings.
 * @param {Array} scraps - An array of scraps to process.
 * @returns {Promise<void>} - A promise that resolves when the batch processing is complete.
 */
async function processScrapBatch(scraps) {
  for (const scrap of scraps) {
    if (scrap.metadata.screenshotUrl) {
      const imageAnalysis = await limiter.schedule(() =>
        analyzeImage(scrap.metadata.screenshotUrl)
      );
      let imageEmbedding = null;
      try {
        // imageEmbedding = await limiter.schedule(() =>
        //   generateImageEmbedding(scrap.metadata.screenshotUrl)
        // );
      } catch (error) {
        console.error(
          `Error generating image embedding for scrap ${scrap.scrap_id}:`,
          error
        );
      }

      await updateScrapImageAnalysis(
        scrap.scrap_id,
        imageAnalysis,
        imageEmbedding
      );
      console.log(
        `Image analysis and embedding updated for scrap ${scrap.scrap_id}`
      );
    }
  }
}

/**
 * Main function that orchestrates the fetching and processing of scraps in batches.
 * @returns {Promise<void>} - A promise that resolves when all scraps have been processed.
 */
async function main() {
  const pageSize = 1000;
  let page = 0;
  let scraps = [];

  do {
    scraps = await fetchScraps(page, pageSize);
    await processScrapBatch(scraps);
    page++;
  } while (scraps.length === pageSize);

  console.log("Image analysis completed for all scraps.");
}

main().catch((error) => console.error("Error in main:", error));
