FROM node:22-bookworm-slim

# Optional offline last-resort narration when browser voices and Kokoro are absent.
RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV DATABASE_URL=postgresql://postgres:postgres@db:5432/app_db
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit push --force && npm run start"]
