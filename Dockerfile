# syntax = docker/dockerfile:1

# Adjust NODE_VERSION as desired
ARG NODE_VERSION=18.17.1
FROM node:${NODE_VERSION}-slim as base


# Install dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH="/usr/bin/chromium"

ENV NODE_ENV=production

# RUN npm update @flydotio/dockerfile
# RUN npx dockerfile

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci
COPY . .

CMD ["node", "scripts/index.mjs", "--all"]
