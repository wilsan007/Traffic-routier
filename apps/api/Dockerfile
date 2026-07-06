FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# --legacy-peer-deps : le workspace mobile (Expo) impose des conflits de peer
# dependencies sans rapport avec l'API mais présents dans le lockfile racine.
RUN npm install --workspace=@trafficguard/api --workspace=@trafficguard/shared --include-workspace-root --legacy-peer-deps
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
