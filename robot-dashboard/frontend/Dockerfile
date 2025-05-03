FROM node:20-alpine

WORKDIR /app

COPY package*.json . 
RUN npm install

# Add missing modules for build
RUN npm install xterm @types/xterm --save
RUN npm install --save-dev typescript @types/react @types/node

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]