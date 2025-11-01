# Use Node.js 20 slim image as base
FROM node:20-slim

# Install system dependencies required for video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY src ./src

# Build the application
RUN npm run build

# Remove devDependencies
RUN npm prune --production

# Create directories for temporary files
RUN mkdir -p /tmp/video-analyzer

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
