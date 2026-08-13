FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
CMD ["sh", "-c", "npm install && npm run dev -- --hostname 0.0.0.0 --port 3000"]
