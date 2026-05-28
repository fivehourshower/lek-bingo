# ---- build stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install all deps needed to build the browser bundle.
COPY package*.json ./
RUN npm install

# App source
COPY . .

# Precompile the browser bundle once, at image build time.
RUN npm run build:client

# ---- runtime stage ----
FROM node:20-alpine

WORKDIR /app

# Install only runtime deps.
COPY package*.json ./
RUN npm install --omit=dev

# Copy runtime files and the prebuilt client bundle.
COPY --from=build /app/server.js ./
COPY --from=build /app/state.js ./
COPY --from=build /app/bingo_words.json ./
COPY --from=build /app/public ./public

# Where state and the editable word list / background live
RUN mkdir -p /app/data
ENV STATE_DB_FILE=/app/data/state.sqlite
ENV WORDS_FILE=/app/bingo_words.json
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health > /dev/null || exit 1

CMD ["node", "server.js"]
