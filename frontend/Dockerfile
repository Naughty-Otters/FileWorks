FROM node:22-alpine
WORKDIR /app

# package.json postinstall needs ./scripts — copy it before npm install.
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

COPY . .
# Re-run worker copy after full tree is present (public/ may have been overwritten).
RUN node ./scripts/copy-pdf-worker.mjs

EXPOSE 3000
ENV HOSTNAME=0.0.0.0
# Bind-mounted source + named node_modules volume; compose runs npm install on start.
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
