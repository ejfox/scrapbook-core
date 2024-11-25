import puppeteer from 'puppeteer-core';
import dotenv from "dotenv";
import path from "path";
import os from 'os';
import winston from 'winston';

// Import Cloudinary
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Add logger
const logger = winston.createLogger({
  level: process.env.DEBUG === "true" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Move the browser declaration to the top
let browser = null;

// Get appropriate browser launcher based on environment
async function getBrowserLauncher() {
  // Production (Fly.io)
  if (process.env.NODE_ENV === 'production') {
    return {
      executablePath: '/usr/bin/chromium', // Ensure this path is correct
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ]
    };
  }

  // Local development (macOS)
  if (os.platform() === 'darwin') {
    return {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: [
        "--no-sandbox",
        "--disable-gpu"
      ]
    };
  }

  throw new Error(`Unsupported environment: ${os.platform()}`);
}

export async function generateScreenshot({ source, shortId, url, timeout = 15000 }) {
  let browser;
  try {
    // Initialize browser
    const launcherOptions = await getBrowserLauncher();
    browser = await puppeteer.launch({
      executablePath: launcherOptions.executablePath,
      args: launcherOptions.args,
      headless: 'new',
      defaultViewport: { width: 1280, height: 800 }
    });

    // Create new page
    const page = await browser.newPage();

    try {
      // Set timeouts
      await page.setDefaultNavigationTimeout(timeout);
      await page.setDefaultTimeout(timeout);

      // Navigate to the URL
      const response = await page.goto(url, { waitUntil: 'networkidle0' });

      // Check if navigation was successful
      if (!response || !response.ok()) {
        throw new Error(`Failed to load URL: ${url}`);
      }

      // Take screenshot
      const screenshotBuffer = await page.screenshot();

      // Upload to Cloudinary using upload_stream
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `scrapbook/${source}`,
            public_id: shortId,
            resource_type: 'image'
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

      return result.secure_url;
    } finally {
      // Close the page
      if (page) {
        await page.close();
      }
    }
  } catch (error) {
    logger.error(`Error generating screenshot: ${error.message}`);
    return null;
  } finally {
    // Close the browser
    if (browser) {
      await browser.close();
    }
  }
}

// Add cleanup function
export async function cleanupScreenshot() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Add cleanup on process exit
process.on('exit', cleanupScreenshot);
process.on('SIGINT', cleanupScreenshot);
process.on('SIGTERM', cleanupScreenshot); 