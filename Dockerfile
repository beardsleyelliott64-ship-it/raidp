# Railway-ready. Playwright browsers come with the official image.
# Avoids the long/fragile `npx playwright install --with-deps` step that usually times out or OOMs on Railway.
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System packages for the Python microservice + port cleanup used by launcher.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    lsof \
    && rm -rf /var/lib/apt/lists/*

# Node deps first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Python venv + curl_cffi stack
RUN python3 -m venv /app/venv
COPY requirements.txt ./
RUN /app/venv/bin/pip install --no-cache-dir -r requirements.txt

# App source
COPY . .

# Fail the build early if entrypoints are syntactically broken
RUN node --check index.js && node --check launcher.js && node --check deployment.js

# Dashboard listens on process.env.PORT (Railway injects it). Health endpoint: /api/health
EXPOSE 3000

CMD ["node", "launcher.js"]
