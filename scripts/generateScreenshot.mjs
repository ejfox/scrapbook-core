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

let browser = null;

// Enhanced browser launcher with better error checking
async function getBrowserLauncher() {
  try {
    if (process.env.NODE_ENV === "production") {
      const execPath = "/usr/bin/chromium";
      // Check if Chrome exists
      try {
        await import("fs").then((fs) => fs.promises.access(execPath));
      } catch {
        throw new Error(`Chrome not found at ${execPath}`);
      }

      return {
        executablePath: execPath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-software-rasterizer",
        ],
      };
    }

    if (os.platform() === "darwin") {
      const execPath =
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      try {
        await import("fs").then((fs) => fs.promises.access(execPath));
      } catch {
        throw new Error(`Chrome not found at ${execPath}`);
      }

      return {
        executablePath: execPath,
        args: ["--no-sandbox", "--disable-gpu"],
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

export async function generateScreenshot({
  source,
  shortId,
  url,
  timeout = 15000,
}) {
  let page = null;

  try {
    logger.info(`Starting screenshot generation for ${url}`);

    // Initialize browser if needed
    if (!browser) {
      logger.debug("Initializing browser...");
      const launcherOptions = await getBrowserLauncher();
      browser = await puppeteer.launch({
        executablePath: launcherOptions.executablePath,
        args: [
          ...launcherOptions.args,
          "--force-device-scale-factor=4", // 4x DPI
        ],
        headless: "new",
        defaultViewport: {
          width: 1080,
          height: 1920,
          deviceScaleFactor: 4, // 4x DPI
        },
      });
      logger.debug("Browser initialized successfully");
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
    // Cleanup
    if (page) {
      try {
        await page.close();
        logger.debug("Page closed successfully");
      } catch (error) {
        logger.error("Error closing page:", error);
      }
    }
  }
}
