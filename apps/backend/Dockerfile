FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY . .

WORKDIR /app/apps/backend

EXPOSE 3001

CMD ["npm", "run", "dev"]
