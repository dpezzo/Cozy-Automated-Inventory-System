# Single-image build for the modular monolith: builds the shared rules
# package, the server, and the React frontend, then runs the Node server,
# which also serves the built frontend as static files (see src/index.ts).
FROM node:24-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

RUN npm run build -w packages/shared \
 && npm run build -w packages/server \
 && npm run build -w packages/web

FROM node:24-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/server/dist packages/server/dist
COPY --from=build /repo/packages/server/migrations packages/server/migrations
COPY --from=build /repo/packages/web/dist packages/web/dist

RUN mkdir -p /data/uploads
VOLUME ["/data/uploads"]

EXPOSE 3000
WORKDIR /repo/packages/server
CMD ["node", "dist/index.js"]
