# Multi-stage build for the Job Hunter dashboard (single service: API + built UI).
# Auto-apply uses Playwright + your local Chrome and is a LOCAL-ONLY feature: the
# npm package is installed but browser binaries are skipped in the image (it can't
# drive a browser from a server), so the cloud image stays lean.

# ---- build stage: install all deps (incl. Vite) and build the React client ----
FROM node:22-slim AS build
WORKDIR /app
# Don't download Playwright browsers during install (auto-apply is local-only).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --workspaces --include-workspace-root
COPY . .
RUN npm run build

# ---- runtime stage: just the server + built client + runtime deps ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# Azure App Service / Container Apps inject PORT; default to 8080 locally.
ENV PORT=8080
# Persisted tracker data (mount a volume / Azure Files here in production).
ENV DATA_DIR=/home/data
EXPOSE 8080
CMD ["node", "server/src/index.js"]
