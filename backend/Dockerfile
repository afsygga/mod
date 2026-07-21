FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p logs
# Immutable build revision → afsyg_build_info metric (passed from CI as the git sha)
ARG GIT_REVISION=unknown
ENV GIT_REVISION=$GIT_REVISION
LABEL org.opencontainers.image.revision=$GIT_REVISION
EXPOSE 4000
# Container-internal readiness probe hits /ready (503 until fully started)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
