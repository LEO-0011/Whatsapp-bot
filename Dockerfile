FROM node:20-alpine
WORKDIR /app

# REQUIRED system deps
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    libc6-compat

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
CMD ["node","index.js"]
