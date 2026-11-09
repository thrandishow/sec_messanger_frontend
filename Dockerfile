FROM node:24.22.2-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Next.js static export; no public API tokens or Node runtime needed to serve the UI.
FROM nginx:1.28-alpine
RUN apk add --no-cache curl
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
USER 1000:1000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail --silent --cacert /tls/ca.crt https://127.0.0.1:8443/health/frontend || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
