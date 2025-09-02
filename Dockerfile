FROM node:20-slim

LABEL org.opencontainers.image.title="Scrapbook Core"
LABEL org.opencontainers.image.description="Personal Knowledge Management System for Digital Ephemera"
LABEL org.opencontainers.image.source="https://github.com/ejfox/scrapbook-core"

# Install system dependencies including Chromium for screenshots
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    tini \
    curl \
    ca-certificates \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure environment
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --disable-background-timer-throttling" \
    CONTAINER_NAME="scrapbook-core"

WORKDIR /app

# Create app user
RUN groupadd --gid 1001 appuser \
    && useradd --uid 1001 --gid appuser --shell /bin/bash --create-home appuser

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY --chown=appuser:appuser . .

# Create necessary directories
RUN mkdir -p data logs temp \
    && chown -R appuser:appuser /app

# Create .env template if it doesn't exist
RUN touch .env.example && chown appuser:appuser .env.example

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command - can be overridden
CMD ["node", "scripts/index.mjs", "--all"]
