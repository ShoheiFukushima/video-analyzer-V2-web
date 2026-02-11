# Use Node.js 20 slim image as base
FROM node:20-slim

# Install system dependencies required for video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    strace \
    file \
    coreutils \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install TransNet V2
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install TransNet V2 and dependencies
# Note: Using CPU-only TensorFlow to reduce image size
# TransNet V2 must be installed from GitHub
RUN pip install --no-cache-dir \
    tensorflow-cpu==2.15.0 \
    numpy \
    pillow \
    && pip install --no-cache-dir git+https://github.com/soCzech/TransNetV2.git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Cache bust to force rebuild when source changes
# Updated: 2026-02-11T11:30:00Z
ARG CACHE_BUST=20260211113000

# Copy source files
COPY src ./src

# Copy Python scripts for TransNet V2
COPY src/services/transnetRunner.py /app/transnetRunner.py

# Copy pre-built build-info.json (contains commit SHA from deploy.sh)
COPY build-info.json ./

# Build the application (skip prebuild since build-info.json already exists)
RUN ./node_modules/.bin/tsc && cp build-info.json dist/

# Remove devDependencies
RUN npm prune --production

# Create directories for temporary files
RUN mkdir -p /tmp/video-analyzer

# Set environment
ENV NODE_ENV=production
# Note: PORT is automatically set by Cloud Run, do not set it here

# Disable fontconfig and other features that can cause hangs in gVisor/Cloud Run
# These are common causes of ffprobe/ffmpeg hanging
ENV FONTCONFIG_PATH=""
ENV FONTCONFIG_FILE="/dev/null"
ENV FC_DEBUG="0"
ENV HOME="/tmp"
ENV XDG_CACHE_HOME="/tmp"
ENV XDG_CONFIG_HOME="/tmp"
ENV FFREPORT=""
ENV AV_LOG_FORCE_NOCOLOR="1"

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
