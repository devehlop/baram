# Сборка
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Mini App
FROM node:22-alpine AS miniapp
WORKDIR /app/miniapp
COPY miniapp/package.json miniapp/package-lock.json ./
RUN npm ci
COPY miniapp/index.html miniapp/tsconfig.json miniapp/vite.config.ts ./
COPY miniapp/src ./src
RUN npm run build

# Запуск
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY locales ./locales
COPY drizzle ./drizzle
COPY --from=miniapp /app/miniapp/dist ./miniapp/dist
USER node
# Миграции базы применяются при старте автоматически.
CMD ["node", "dist/index.js"]
