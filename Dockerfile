# Use Node.js LTS as base image
FROM node:20-slim

# Install ts-node globally for runtime TypeScript execution
RUN npm install -g ts-node typescript

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Build the TypeScript project
RUN npm run build

# Expose port if needed (optional with --network host)
EXPOSE 3001

# Default command - runs the MCP server
CMD ["npm", "run", "start"]
