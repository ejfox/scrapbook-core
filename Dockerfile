FROM node:18.17.1-slim

# Install essential dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    tini \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH="/usr/bin/chromium"

WORKDIR /usr/src/app

# Install dependencies first to leverage Docker caching
COPY package*.json ./
RUN npm ci

# Copy app files with correct ownership
COPY . .
RUN chown -R node:node .

# Switch to non-root user
USER node

# Use tini as init system
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/index.mjs", "--all"]
