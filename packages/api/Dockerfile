# syntax=docker/dockerfile:1

# The API is plain JavaScript, so it is compiled once on the builder's own platform; only the compiled
# workspace packages it imports and their runtime dependencies enter the per-architecture image. It
# holds no content tree and no mod file: the catalogue archives it converts live on the data volume.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /src
COPY . .
# The API workspace with what its build needs. The runtime layout is assembled here so the final
# stage only copies it: render enters for its pure `data` helpers (the minimap synthesizer's inputs),
# sim because those helpers import it; neither Pixi nor a content directory is copied.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @open-northland/api --include-workspace-root --no-audit --no-fund \
    && npx tsc --build packages/api \
    && mkdir -p /app/node_modules/@open-northland /app/node_modules/@noble /app/packages \
    && for dep in fflate node-unrar-js zod; do cp -R node_modules/$dep /app/node_modules/$dep; done \
    && cp -R node_modules/@noble/hashes /app/node_modules/@noble/hashes \
    && for pkg in api map-import formats data render sim; do \
         mkdir -p /app/packages/$pkg \
         && cp packages/$pkg/package.json /app/packages/$pkg/ \
         && cp -R packages/$pkg/dist /app/packages/$pkg/dist \
         && ln -s ../../packages/$pkg /app/node_modules/@open-northland/$pkg; \
       done

FROM node:22-alpine

ARG API_BUILD=
ENV NODE_ENV=production \
    PORT=8790 \
    ON_API_DATA_DIR=/data \
    API_BUILD=$API_BUILD

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland API: the map catalogue and its converted maps" \
      org.opencontainers.image.licenses=AGPL-3.0-or-later

WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "packages/api/dist/main.js"]
