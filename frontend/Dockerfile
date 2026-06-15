FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli build-base python3

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
