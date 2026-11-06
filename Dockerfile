# syntax=docker/dockerfile:1

# Node runs the TypeScript directly, so there is no build stage: the image is the
# runtime plus `src/`. No `.env` is copied in, deliberately — see .dockerignore.
FROM node:24-alpine

# `image.source` links the GHCR package to this repository, which is what makes
# the package inherit the repo's visibility and permissions.
LABEL org.opencontainers.image.source="https://github.com/alexewerlof/deepseek-search-mcp" \
      org.opencontainers.image.description="DeepSeek Search and Fetch as MCP tools over Streamable HTTP" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Dependencies first, so editing source does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Nothing is written after startup, so the container can run --read-only.
USER node

# A container's loopback is unreachable through a published port, so bind all
# interfaces by default. That makes the bind non-loopback, which means the server
# refuses to start without MCP_AUTH_TOKEN. Override with
# -e MCP_HTTP_HOST=127.0.0.1 when only the host machine needs to reach it.
# MCP_ALLOWED_HOSTS is optional; setting it adds a `Host` check on top of the token.
ENV MCP_HTTP_HOST=0.0.0.0
EXPOSE 8765

# Exec form, not `npm start`: node stays PID 1 so SIGTERM reaches the shutdown
# handler in main.ts. There is no `.env` in the image for the flag to load.
CMD ["node", "src/main.ts"]
