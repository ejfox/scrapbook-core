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

export async function generateScreenshot({
  source,
  shortId,
  url,
  timeout = 15000,
}) {
  let browser = null;
  let page = null;

  try {
    logger.info(`Starting screenshot generation for ${url}`);

    // Connect to existing browser or launch new one
    if (browserWSEndpoint) {
      browser = await puppeteer.connect({ browserWSEndpoint });
    } else {
      browser = await puppeteer.launch({
        executablePath: getChromePath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--single-process",
        ],
        headless: "new",
      });
      browserWSEndpoint = browser.wsEndpoint();
    }

    // Create new page with error monitoring
    page = await browser.newPage();

    // Set viewport for portrait screenshots
    await page.setViewport({
      width: 1080,
      height: 1920,
      deviceScaleFactor: 4, // 4x DPI
    });

    // Monitor console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        logger.debug(`Console error for ${url}: ${msg.text()}`);
      }
    });

    // Monitor network errors
    page.on("requestfailed", (request) => {
      logger.debug(
        `Failed request for ${url}: ${request.url()} - ${
          request.failure().errorText
        }`
      );
    });

    // Set timeouts
    await page.setDefaultNavigationTimeout(timeout);
    await page.setDefaultTimeout(timeout);

    // Set user agent to look more like a real browser
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
    );

    logger.debug(`Navigating to ${url}...`);

    // Navigate with detailed error handling
    const response = await page.goto(url, {
      waitUntil: "networkidle0",
      timeout,
    });

    if (!response) {
      throw new Error(`No response received from ${url}`);
    }

    if (!response.ok()) {
      throw new Error(
        `Failed to load URL: ${url} - ${getResponseError(response)}`
      );
    }

    // Check if page has content
    const content = await page.content();
    if (!content || content.length < 100) {
      throw new Error(`Page loaded but appears empty: ${url}`);
    }

    // Take full-page screenshot with high quality settings
    logger.debug("Taking screenshot...");
    const screenshotBuffer = await page.screenshot({
      type: "jpeg",
      quality: 100,
      fullPage: true, // Capture entire page height
      captureBeyondViewport: true, // Ensure we get everything
    });
    logger.debug("Screenshot captured successfully");

    // Upload to Cloudinary with optimization settings
    logger.debug("Uploading to Cloudinary...");
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `scrapbook/${source}`,
          public_id: shortId,
          resource_type: "image",
          format: "jpg",
          quality: 90, // High quality but with some compression
          density: 400, // 4x DPI
          transformation: [
            { width: 1080, height: 1920, crop: "limit" },
            { quality: "auto:best" },
          ],
        },
        (error, result) => {
          if (error) {
            logger.error(`Cloudinary upload error: ${error.message}`);
            return reject(error);
          }
          resolve(result);
        }
      );
      uploadStream.end(screenshotBuffer);
    });

    logger.info(`Screenshot generated and uploaded successfully for ${url}`);
    return result.secure_url;
  } catch (error) {
    // Enhanced error reporting
    let errorDetails = error.message;

    if (error.name === "TimeoutError") {
      errorDetails = `Timeout (${timeout}ms) - Page took too long to load`;
    }

    if (error.message.includes("net::")) {
      errorDetails = `Network error - ${error.message}`;
    }

    logger.error(`Screenshot generation failed for ${url}:
    Error: ${errorDetails}
    Browser: ${browser ? "Running" : "Not initialized"}
    Platform: ${os.platform()}
    Node Version: ${process.version}
    Memory: ${Math.round(
      process.memoryUsage().heapUsed / 1024 / 1024
    )}MB used`);

    return null;
  } finally {
    if (page) {
      await page.close().catch((e) => logger.error("Error closing page:", e));
    }
    // Don't close the browser, just disconnect if we connected to existing one
    if (browser && !browserWSEndpoint) {
      await browser
        .close()
        .catch((e) => logger.error("Error closing browser:", e));
    }
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
