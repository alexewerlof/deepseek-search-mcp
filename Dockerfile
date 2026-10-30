# syntax=docker/dockerfile:1

# Node runs the TypeScript directly, so there is no build stage: the image is the
# runtime plus `src/`. No `.env` is copied in, deliberately — see .dockerignore.
FROM node:24-alpine

WORKDIR /app

# Dependencies first, so editing source does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Nothing is written after startup, so the container can run --read-only.
USER node

# A container's loopback is unreachable through a published port, so bind all
# interfaces by default. That makes the bind non-loopback, which means the server
# refuses to start without MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS. Override with
# -e MCP_HTTP_HOST=127.0.0.1 when only the host machine needs to reach it.
ENV MCP_HTTP_HOST=0.0.0.0
EXPOSE 8765

# Exec form, not `npm start`: node stays PID 1 so SIGTERM reaches the shutdown
# handler in main.ts. There is no `.env` in the image for the flag to load.
CMD ["node", "src/main.ts"]
