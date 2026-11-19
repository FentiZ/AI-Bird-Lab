FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY hardhat.config.js server.cjs ./
COPY contracts ./contracts
COPY scripts ./scripts
COPY tests ./tests
CMD ["npm", "run", "node"]
