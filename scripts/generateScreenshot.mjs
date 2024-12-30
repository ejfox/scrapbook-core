import puppeteer from "puppeteer-core";
import dotenv from "dotenv";
import path from "path";
import os from "os";
import winston from "winston";
import { v2 as cloudinary } from "cloudinary";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper function to upload to Cloudinary
async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "scrapbook/screenshots",
        format: "jpg",
        quality: "auto:good",
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

// Enhanced logger
const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Add browser lifecycle management
let browserWSEndpoint = null;

// Enhanced browser launcher with better error checking
async function getBrowserLauncher() {
  try {
    // Production configuration for Fly.io
    if (process.env.NODE_ENV === "production") {
      return {
        executablePath: "/usr/bin/chromium",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-dev-shm-usage", // Important for Docker/Fly.io
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote", // Recommended for running in containers
          "--single-process", // Recommended for containerized environments
          "--disable-extensions",
          "--window-size=1080,1920",
        ],
        headless: "new",
        defaultViewport: {
          width: 1080,
          height: 1920,
          deviceScaleFactor: 2,
        },
      };
    }

    // Development configuration
    if (os.platform() === "darwin") {
      return {
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ["--no-sandbox", "--disable-gpu"],
        headless: "new",
      };
    }

    throw new Error(`Unsupported platform: ${os.platform()}`);
  } catch (error) {
    logger.error("Browser launcher error:", error);
    throw error;
  }
}

// Helper to get detailed error info from response
function getResponseError(response) {
  if (!response) return "No response received";

  const status = response.status();
  const statusText = response.statusText();

  const errorMap = {
    401: "Unauthorized - Site requires authentication",
    403: "Forbidden - Site blocked our request",
    404: "Page not found",
    429: "Too many requests - We were rate limited",
    500: "Server error on target site",
    503: "Service unavailable - Site might be down",
  };

  return errorMap[status] || `HTTP ${status} - ${statusText}`;
}

// Add Chrome path detection
const getChromePath = () => {
  if (process.env.CHROME_EXECUTABLE_PATH) {
    return process.env.CHROME_EXECUTABLE_PATH;
  }

  // Default paths by platform
  switch (process.platform) {
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    case "linux":
      return "/usr/bin/chromium";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
};

// Add retry logic
async function takeScreenshotWithRetry(page, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const screenshotBuffer = await page.screenshot({
        type: "jpeg",
        quality: 85,
        fullPage: false,
        captureBeyondViewport: false,
      });
      return screenshotBuffer;
    } catch (error) {
      logger.warn(`Screenshot attempt ${i + 1} failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await page.waitForTimeout(1000);
    }
  }
}

export async function generateScreenshot(url) {
  if (!url) {
    throw new Error("URL is required for screenshot generation");
  }

  // Ensure url is a string and handle URL objects
  const urlString =
    typeof url === "object" && url.href ? url.href : String(url);

  // Basic URL validation and normalization
  try {
    url = new URL(urlString).toString();
  } catch (error) {
    logger.warn(`Invalid URL format: ${urlString}`);
    throw new Error(`Invalid URL format: ${urlString}`);
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: getChromePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    // Set a reasonable timeout
    await page.setDefaultNavigationTimeout(30000);

    // Navigate and wait for network idle
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Brief wait for critical content
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Take the screenshot
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 80,
      fullPage: true,
    });

    // Upload to Cloudinary using the imported function
    const result = await uploadToCloudinary(screenshot);
    return { url: result.secure_url };
  } catch (error) {
    throw error;
  } finally {
    await browser.close();
  }
}

// Add cleanup on process exit
process.on("SIGTERM", async () => {
  if (browserWSEndpoint) {
    try {
      const browser = await puppeteer.connect({ browserWSEndpoint });
      await browser.close();
    } catch (error) {
      logger.error("Error cleaning up browser:", error);
    }
  }
});

export async function handleArenaImage(scrap) {
  // Arena blocks have image data in their source_data
  if (!scrap.source_data?.image) {
    throw new Error("No image data in Arena block");
  }

  // Get the highest resolution image URL
  // Arena provides: large, display, square, thumb versions
  const imageUrl =
    scrap.source_data.image.large?.url ||
    scrap.source_data.image.display?.url ||
    scrap.source_data.image.original?.url;

  if (!imageUrl) {
    throw new Error("No suitable image URL found in Arena block");
  }

  try {
    // Upload directly to Cloudinary using the URL
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: "scrapbook/arena",
      format: "jpg",
      quality: "auto:good",
    });

    return { url: result.secure_url };
  } catch (error) {
    throw new Error(`Failed to upload Arena image: ${error.message}`);
  }
}
