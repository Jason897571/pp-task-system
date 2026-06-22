# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app

# Install deps (incl. dev deps needed for `tsc -b` + vite build).
# Default to the npmmirror registry (fast inside China); override with
#   docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org/
# Using `npm install` (not `npm ci`) so a slightly out-of-sync lock file still
# builds — the lock omits some cross-platform optional deps (e.g. @emnapi/*).
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json* ./
RUN npm install --registry=${NPM_REGISTRY} --no-audit --no-fund

COPY . .
RUN npm run build

# --- serve stage ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
