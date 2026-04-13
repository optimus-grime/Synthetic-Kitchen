FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
