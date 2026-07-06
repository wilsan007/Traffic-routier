FROM node:20-alpine
ARG NEXT_PUBLIC_API_URL=http://localhost:4001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_HLS_URL=http://localhost:8888
ENV NEXT_PUBLIC_HLS_URL=$NEXT_PUBLIC_HLS_URL
WORKDIR /app
COPY package*.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# --legacy-peer-deps : conflits de peer deps du workspace mobile (Expo) dans le lockfile racine
RUN npm install --workspace=@trafficguard/web --workspace=@trafficguard/shared --include-workspace-root --legacy-peer-deps
WORKDIR /app/apps/web
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
