# Stage 1: Build React App
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci 
#--only=production

# Copy source code
COPY . .

# Build arg for Vite env (overrides .env file)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Build React app for production
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy custom nginx config (optional - if you need custom config)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# ✅ Tambah config SPA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built React app from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
