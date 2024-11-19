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

export async function generateScreenshot({ source, shortId, url }) {
  if (!url) return null;
  let browser;
  
  try {
    const launchOptions = await getBrowserLauncher();
    browser = await puppeteer.launch({
      ...launchOptions,
      headless: "new",
      defaultViewport: { width: 1080, height: 1920 }
    });

    logger.info('Browser launched successfully');
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1080, height: 1920 });
    logger.info(`Navigating to ${url}`);
    
    await page.goto(url, { 
      waitUntil: "networkidle0", 
      timeout: 30000 
    });
    
    const screenshotBuffer = await page.screenshot({ 
      type: 'png',
      fullPage: false,
      timeout: 30000
    });

    await browser.close();

    const filename = `${shortId}.png`;
    const cdnPath = path.join('screenshots', source, filename);
    
    console.log('Uploading to CDN');
    const cdnUrl = await uploadToCDN(screenshotBuffer, cdnPath);
    return cdnUrl;

  } catch (error) {
    console.error(`Screenshot failed for ${url}:`, error);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('Error closing browser:', err);
      }
    }
  }
} 