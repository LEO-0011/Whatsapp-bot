FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node","index.js"]
