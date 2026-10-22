# syntax=docker/dockerfile:1
# app and content are named build contexts: --build-context app=packages/app/dist --build-context content=content
FROM nginx:1.31-alpine

# The master runs without root; only runtime state belongs in the writable temporary directory.
RUN sed -i '/^user /d; s!^pid .*;!pid /tmp/nginx.pid;!' /etc/nginx/nginx.conf

ARG SOURCE_URL=https://github.com/s-nems/open-northland
LABEL org.opencontainers.image.source=$SOURCE_URL \
      org.opencontainers.image.description="OpenNorthland web app: the game with its converted content" \
      org.opencontainers.image.licenses=AGPL-3.0-or-later

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app / /srv/open-northland/
COPY --from=content / /srv/content/

# The app fetches content under /c/<hash>, the hash packages/app/build/content-hash.ts took of the tree
# it was built against. Rehash the tree this image ships the same way and refuse a mismatch, so the
# immutable prefix only ever names these bytes. nginx follows a symlink the hash skips, so one fails.
RUN set -euo pipefail; \
    link="$(find /srv/content -type l | head -n 1)"; \
    if [ -n "$link" ]; then echo "content must not hold a symlink: $link" >&2; exit 1; fi; \
    shipped="$(cd /srv/content && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f 1)"; \
    built="$(sed -n 's/.*"content":"\([0-9a-f]\{64\}\)".*/\1/p' /srv/open-northland/version.json)"; \
    if [ -z "$built" ]; then \
      echo "the app carries no content hash in version.json: build the app with content/ present" >&2; exit 1; \
    fi; \
    if [ "$shipped" != "$built" ]; then \
      echo "the app was built against content '$built', the image ships content '$shipped'" >&2; exit 1; \
    fi; \
    sed -i "s/@CONTENT_HASH@/$shipped/" /etc/nginx/conf.d/default.conf

# Precompressed copies for gzip_static, after the hash: they are not part of the shipped tree.
RUN find /srv/open-northland /srv/content -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' \) -print0 \
      | xargs -0 -r -P "$(nproc)" -n 64 gzip -9 -k

USER nginx

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget --quiet --spider http://127.0.0.1/healthz || exit 1
