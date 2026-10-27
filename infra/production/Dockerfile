FROM node:22-bookworm-slim AS build
ENV CI=true
ARG ADMIN_API_PROXY_TARGET=http://api:3002
ARG STOREFRONT_API_PROXY_TARGET=http://api:3002
ENV ADMIN_API_PROXY_TARGET=$ADMIN_API_PROXY_TARGET
ENV STOREFRONT_API_PROXY_TARGET=$STOREFRONT_API_PROXY_TARGET
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm build

FROM node:22-bookworm-slim AS runtime-base
ENV NODE_ENV=production
WORKDIR /workspace
RUN corepack enable
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build --chown=node:node /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages ./packages
COPY --from=build --chown=node:node /workspace/database ./database

# Fail the image build if the Prisma CLI needed by the release migration is
# absent from the database workspace package in the runtime image.
RUN test -x /workspace/database/node_modules/.bin/prisma \
    && /workspace/database/node_modules/.bin/prisma --version

USER node

FROM runtime-base AS storefront
WORKDIR /workspace/apps/storefront
COPY --from=build --chown=node:node /workspace/apps/storefront/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/storefront/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/storefront/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /workspace/apps/storefront/.next ./.next
COPY --from=build --chown=node:node /workspace/apps/storefront/public ./public
EXPOSE 3000
CMD ["node", "/workspace/node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

FROM runtime-base AS admin
WORKDIR /workspace/apps/admin
COPY --from=build --chown=node:node /workspace/apps/admin/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/admin/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/admin/next.config.mjs ./next.config.mjs
COPY --from=build --chown=node:node /workspace/apps/admin/.next ./.next
COPY --from=build --chown=node:node /workspace/apps/admin/public ./public
EXPOSE 3001
CMD ["node", "/workspace/node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3001"]

FROM runtime-base AS api
WORKDIR /workspace/apps/api
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist ./dist
EXPOSE 3002
CMD ["node", "dist/main.js"]

FROM runtime-base AS worker
WORKDIR /workspace/apps/worker
COPY --from=build --chown=node:node /workspace/apps/worker/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/worker/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./dist
CMD ["node", "dist/index.js"]
