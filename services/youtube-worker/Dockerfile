FROM node:22-bookworm-slim

# The worker performs downloads outside Vercel. yt-dlp uses Node for its
# JavaScript challenges and ffmpeg to combine adaptive audio/video streams.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
    && python3 -m pip install --break-system-packages --no-cache-dir 'yt-dlp[default]==2026.10.26' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs ./server.mjs
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
