# Use the official Playwright image which includes all necessary system dependencies and browsers
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Create and set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies
# Note: We skip the playwright browser download during npm install 
# because we will use the ones pre-installed in the image or install them explicitly
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install

# Install the specific playwright version browsers if needed, 
# though the image already contains them for its version.
# To be safe and ensure the exact version matches your package.json:
RUN npx playwright install chromium

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "server.js"]
