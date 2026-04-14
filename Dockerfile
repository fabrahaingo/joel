FROM node:24-slim

# sharp needs these native libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]