import puppeteer from 'puppeteer-core';
import dotenv from "dotenv";
import path from "path";
import { uploadToCDN } from "./cdnHelpers.mjs";
import os from 'os';
import winston from 'winston';

dotenv.config();

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

// Get appropriate browser launcher based on environment
async function getBrowserLauncher() {
  // Production (Fly.io)
  if (process.env.NODE_ENV === 'production') {
    return {
      executablePath: '/usr/bin/chromium',
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ]
    };
  }

  // Local development
  if (os.platform() === 'darwin') {
    try {
      // Try system Chrome first
      return {
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: [
          "--no-sandbox",
          "--disable-gpu"
        ]
      };
    } catch (error) {
      console.log('System Chrome not found, installing Puppeteer...');
      // Fallback to full Puppeteer if needed
      const puppeteer = await import('puppeteer');
      return {
        // Let Puppeteer use its bundled Chromium
        args: ["--no-sandbox"]
      };
    }
  }

  throw new Error(`Unsupported environment: ${os.platform()}`);
}

let browser = null;

export async function generateScreenshot({ source, shortId, url, timeout = 15000 }) {
  try {
    // Initialize browser if needed
    if (!browser) {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: 'new',
        defaultViewport: { width: 1280, height: 800 }
      });
    }

    // Create new page
    const page = await browser.newPage();
    
    try {
      // Set shorter timeouts
      await page.setDefaultNavigationTimeout(timeout);
      await page.setDefaultTimeout(timeout);

      // Navigate and screenshot
      await page.goto(url, { waitUntil: 'networkidle0' });
      const screenshot = await page.screenshot();

      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(screenshot, {
        folder: `scrapbook/${source}`,
        public_id: shortId
      });

      return result.secure_url;
    } finally {
      // Always close the page
      await page.close();
    }
  } catch (error) {
    logger.error(`Error generating screenshot: ${error.message}`);
    return null;
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