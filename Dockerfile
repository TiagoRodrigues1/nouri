# One image serves the API and the built page. It applies pending migrations on start, so run one instance.
FROM node:26-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.33.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN npm install -g pnpm@10.33.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/
RUN pnpm install --prod --frozen-lockfile --filter nouri-api
COPY src src
COPY db db
COPY data data
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["sh", "-c", "node --import=tsx src/db/migrate.ts && exec node --import=tsx src/server.ts"]
