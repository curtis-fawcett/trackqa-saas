#!/bin/bash
cd /home/team/shared/trackqa-saas
# Kill any existing processes on ports 3000 and 3001
sudo sh -c 'lsof -t -iTCP:3000 -sTCP:LISTEN | xargs -r kill; lsof -t -iTCP:3001 -sTCP:LISTEN | xargs -r kill' 2>/dev/null
sleep 1
# Load env and start PM2
export $(grep -v '^#' .env | xargs)
npx pm2 start ecosystem.config.cjs
