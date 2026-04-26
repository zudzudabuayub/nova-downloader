FROM node:20-bookworm-slim

WORKDIR /app

# System dependencies required by yt-dlp and media processing
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip
RUN pip3 install --no-cache-dir yt-dlp

# Copy project files and install dependencies
COPY . .
RUN npm install

# Build Next.js app
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
