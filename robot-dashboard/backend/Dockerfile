FROM node:20-alpine

WORKDIR /app

# Create a minimal package.json (you can also COPY one in if you prefer)
RUN npm init -y

# Install required backend packages
RUN npm install express ws ssh2

# Copy server code
COPY . .

# Expose WebSocket port
EXPOSE 5000

# Run backend server
CMD ["node", "server.js"]