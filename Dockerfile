# ---- build/runtime image ----
FROM node:20-alpine

WORKDIR /app

# Install deps (cached if package*.json unchanged)
COPY package*.json ./
RUN npm install --omit=dev

# App source
COPY . .

# Where state and the editable word list / background live
RUN mkdir -p /app/data
ENV STATE_DB_FILE=/app/data/state.sqlite
ENV WORDS_FILE=/app/bingo_words.json
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health > /dev/null || exit 1

CMD ["node", "server.js"]
