FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.mjs ./
USER node
EXPOSE 3987
CMD ["node", "server.mjs"]
