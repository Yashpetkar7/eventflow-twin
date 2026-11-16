# EventFlow Twin web app (Next.js production build). The 3D scene and fonts are baked into public/: no CDN at run time.
#   docker build -t eventflow-web --build-arg NEXT_PUBLIC_API_URL=http://localhost:8000 apps/web
FROM node:22-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web/package.json /web/package-lock.json ./
COPY --from=build /web/node_modules ./node_modules
COPY --from=build /web/.next ./.next
COPY --from=build /web/public ./public
COPY --from=build /web/next.config.* ./
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
