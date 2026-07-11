FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copier package.json racine + lockfile + workspaces
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Installer les dépendances du workspace API + shared
RUN npm install --workspace=@trafficguard/api --workspace=@trafficguard/shared --include-workspace-root --legacy-peer-deps

# Copier le code source
COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api

# Générer le client Prisma + build
RUN npx prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
