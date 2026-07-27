FROM node:lts-slim

ADD push-gateway/ ./
RUN npm install

EXPOSE 3000

CMD ["npm", "run", "start"]
