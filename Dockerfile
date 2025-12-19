FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node","index.js"]
