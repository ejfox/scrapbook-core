FROM node:18.17.1-slim

# Install essential dependencies including cron
RUN apt-get update && apt-get install -y \
    chromium \
    cron \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH="/usr/bin/chromium"

WORKDIR /usr/src/app

# Create directories and set up cron
RUN mkdir -p data logs \
    && echo "20 * * * * cd /usr/src/app && node scripts/index.mjs --all >> /usr/src/app/logs/cron.log 2>&1" > /etc/cron.d/scrapbook \
    && chmod 0644 /etc/cron.d/scrapbook \
    && crontab /etc/cron.d/scrapbook

# Install dependencies first to leverage Docker caching
COPY package*.json ./
RUN npm ci

# Copy app files with correct ownership
COPY . .
RUN chown -R node:node .

# Switch to non-root user for running the application
USER node

# The entrypoint script will be handled by docker-compose
CMD ["node", "scripts/index.mjs", "--all"]
