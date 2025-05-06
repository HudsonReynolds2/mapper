FROM node:22-alpine

WORKDIR /app

# ---- Add ARG declarations ----
ARG NEXT_PUBLIC_BACKEND_WS_URL
ARG NEXT_PUBLIC_GRADIO_URL

# ---- Set ENV variables from ARGs for the build process ----
ENV NEXT_PUBLIC_BACKEND_WS_URL=$NEXT_PUBLIC_BACKEND_WS_URL
ENV NEXT_PUBLIC_GRADIO_URL=$NEXT_PUBLIC_GRADIO_URL

COPY package*.json . 
RUN npm install

# Add missing modules for build
RUN npm install xterm @types/xterm --save
RUN npm install --save-dev typescript @types/react @types/node

COPY . .

RUN npm run build

EXPOSE 3000

RUN echo "Building frontend with WS URL: $NEXT_PUBLIC_BACKEND_WS_URL"

CMD ["npm", "start"]