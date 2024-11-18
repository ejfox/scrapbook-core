FROM node:18.17.1-slim

# Install only essential dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH="/usr/bin/chromium"

WORKDIR /usr/src/app

# Create data directory with correct permissions
RUN mkdir -p data && chown -R node:node .

# Install dependencies first to leverage Docker caching
COPY --chown=node:node package*.json ./
RUN npm ci

# Copy app files with correct ownership
COPY --chown=node:node . .

# Switch to non-root user
USER node

# Run the script
CMD ["node", "scripts/index.mjs", "--all"]
