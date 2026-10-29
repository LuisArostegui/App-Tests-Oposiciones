# syntax=docker/dockerfile:1

FROM node:22.23.2-bookworm-slim AS dependencies
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . ./
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# dist/index.cjs retains external production dependencies (for example pg and
# bcryptjs), so the runtime contains the pruned production node_modules tree.
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/script/db-migrate.mjs ./script/db-migrate.mjs

USER node
EXPOSE 5000

CMD ["node", "dist/index.cjs"]
