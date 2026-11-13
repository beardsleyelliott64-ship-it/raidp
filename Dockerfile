FROM node:22-bookworm
ENV NODE_ENV=production
# Keep the browser install path identical during image build and bot runtime.
ENV PLAYWRIGHT_BROWSERS_PATH=0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev && npx playwright install --with-deps chromium
RUN python3 -m venv /app/venv
COPY requirements.txt ./
RUN /app/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY . .
RUN node --check index.js && node --check launcher.js && node --check deployment.js
CMD ["node", "launcher.js"]
