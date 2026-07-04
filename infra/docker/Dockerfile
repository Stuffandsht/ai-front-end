FROM docker.io/library/node:24-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig*.json ./

RUN npm install

EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@agent-platform/web"]
