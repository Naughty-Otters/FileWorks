FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
EXPOSE 3000
ENV HOSTNAME=0.0.0.0
# Bind-mounted source + named node_modules volume; install only at image build.
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
