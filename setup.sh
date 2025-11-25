#!/bin/bash

# Purplixi API Server - Quick Setup Script
# This script automates the installation and configuration of the API server

set -e

echo "╔═══════════════════════════════════════════════════════╗"
echo "║         Purplixi API Server - Quick Setup             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed!${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓${NC} Node.js ${NODE_VERSION} detected"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed!${NC}"
    exit 1
fi

NPM_VERSION=$(npm -v)
echo -e "${GREEN}✓${NC} npm ${NPM_VERSION} detected"
echo ""

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} Dependencies installed successfully"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi

echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${BLUE}⚙️  Creating configuration file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env file"
    echo ""
    echo -e "${YELLOW}📝 Please edit .env file to configure your server${NC}"
    echo ""
    
    # Ask for port
    read -p "Enter server port (default: 3000): " PORT
    PORT=${PORT:-3000}
    sed -i.bak "s/PORT=3000/PORT=$PORT/" .env
    
    # Ask for CORS origins
    echo ""
    echo "Configure CORS allowed origins:"
    echo "  - For development: * (allow all)"
    echo "  - For production: https://yourdomain.com"
    read -p "Enter allowed origins (default: *): " ORIGINS
    ORIGINS=${ORIGINS:-*}
    sed -i.bak "s|ALLOWED_ORIGINS=\*|ALLOWED_ORIGINS=$ORIGINS|" .env
    
    rm -f .env.bak
    
    echo ""
    echo -e "${GREEN}✓${NC} Configuration saved"
else
    echo -e "${YELLOW}ℹ${NC}  Configuration file already exists"
fi

echo ""

# Create data directory
mkdir -p data
echo -e "${GREEN}✓${NC} Data directory ready"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║             Setup Complete!                           ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo -e "${GREEN}1.${NC} Start the server:"
echo "   npm start"
echo ""
echo -e "${GREEN}2.${NC} Or use PM2 for production (recommended):"
echo "   npm install -g pm2"
echo "   pm2 start server.js --name purplixi-api"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo -e "${GREEN}3.${NC} Test the server:"
echo "   curl http://localhost:${PORT:-3000}/health"
echo ""
echo -e "${YELLOW}📚 Documentation:${NC} See README.md for full API documentation"
echo ""
