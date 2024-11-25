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

  // Local development
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

// In the launch function, ensure to use the returned launcher
browser = await puppeteer.launch({
  executablePath: (await getBrowserLauncher()).executablePath,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  headless: 'new',
  defaultViewport: { width: 1280, height: 800 }
}); 