# MCP server image (stdio). Without a key it starts in demo mode (recorded Qloo answers, Vienna example only) so automated
# checks can list and call the tool. For live use: -e QLOO_TRANSPORT=mcp -e QLOO_API_KEY=... -e QLOO_BASE_URL=... -e QLOO_TRUSTED_BASE_URL=...
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV QLOO_TRANSPORT=demo
CMD ["node", "mcp-server.js"]
