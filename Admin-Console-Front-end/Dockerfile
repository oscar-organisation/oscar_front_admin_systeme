# =============================================================================
# Frontend Console Admin OSCAR - build Vite puis service statique via Nginx
# La configuration publique est injectee au demarrage, sans rebuild du bundle.
# =============================================================================

# --- Etape 1 : build de la SPA React/Vite ---
FROM node:20-alpine AS build
WORKDIR /app

# Dependances (cache Docker sur les lockfiles)
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Etape 2 : service statique Nginx avec fallback SPA ---
FROM nginxinc/nginx-unprivileged:1.29-alpine AS production
COPY --chown=101:101 --from=build /app/dist /usr/share/nginx/html
COPY --chown=101:101 runtime-config.template.js /usr/share/nginx/html/runtime-config.template.js
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 3000
USER 101
CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/runtime-config.template.js > /usr/share/nginx/html/runtime-config.js && exec nginx -g 'daemon off;'"]
