FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY . .

WORKDIR /app/apps/frontend

EXPOSE 5173

CMD ["npm", "run", "dev"]
