#!/bin/bash

# Script to run the real-time accent conversion validator

# Set colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Ensure clean exit with proper cleanup
function cleanup {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    # Kill any lingering node processes related to our script
    pkill -f "node.*validate-realtime.js" > /dev/null 2>&1
    exit 0
}

# Set up trap for proper cleanup on exit signals
trap cleanup SIGINT SIGTERM EXIT

echo -e "${YELLOW}Real-time Accent Conversion Validator${NC}"
echo "============================================"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check for SoX (Sound eXchange) which provides the 'rec' command
if ! command -v rec &> /dev/null; then
    echo -e "${RED}Error: SoX (Sound eXchange) is not installed${NC}"
    echo "The node-microphone package requires SoX for audio recording."
    echo ""
    echo "To install SoX:"
    echo ""
    echo "On macOS:"
    echo "  brew install sox"
    echo ""
    echo "On Ubuntu/Debian:"
    echo "  sudo apt-get install sox libsox-fmt-all"
    echo ""
    echo "On Windows:"
    echo "  Download from http://sox.sourceforge.net/"
    echo "  Or install with Chocolatey: choco install sox.portable"
    echo ""
    exit 1
fi

# Check if script exists
if [ ! -f "$(dirname "$0")/validate-realtime.js" ]; then
    echo -e "${RED}Error: Validation script not found${NC}"
    echo "Make sure you're running this from the project root directory"
    exit 1
fi

# Make validate-realtime.js executable
chmod +x "$(dirname "$0")/validate-realtime.js"

# Check for required packages
echo -e "${YELLOW}Checking dependencies...${NC}"
MISSING_DEPS=false

# Check for node-microphone dependency
if ! npm list node-microphone > /dev/null 2>&1; then
    echo -e "${YELLOW}Node-microphone package not found. Installing dependencies...${NC}"
    MISSING_DEPS=true
fi

# Check for speaker dependency
if ! npm list speaker > /dev/null 2>&1; then
    echo -e "${YELLOW}Speaker package not found. Installing dependencies...${NC}"
    MISSING_DEPS=true
fi

# Install dependencies if missing
if [ "$MISSING_DEPS" = true ] || [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Check if Google Cloud credentials exist
if [ ! -f "./config/creds.json" ] && [ -z "$GOOGLE_API_KEY" ]; then
    echo -e "${YELLOW}Warning: No Google Cloud credentials found.${NC}"
    echo "You need either:"
    echo "1. A credentials file at ./config/creds.json"
    echo "2. A GOOGLE_API_KEY environment variable"
    
    # Prompt user to continue
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Validation aborted.${NC}"
        exit 1
    fi
fi

# Create config directory if it doesn't exist
if [ ! -d "./config" ]; then
    mkdir -p ./config
fi

# Run the validation script
echo -e "${GREEN}Starting validation...${NC}"
node "$(dirname "$0")/validate-realtime.js" 