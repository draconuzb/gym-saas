.PHONY: install dev build docker docker-stop db-setup pm2-start pm2-stop pm2-logs

# Install all dependencies
install:
	cd backend && npm install
	cd frontend && npm install

# Start both API and frontend in dev mode
dev:
	npx concurrently \
		"cd backend && npm run dev" \
		"cd frontend && npm run dev"

# Build frontend for production
build:
	cd frontend && npm run build

# Docker: launch full stack
docker:
	docker-compose up --build

# Docker: stop
docker-stop:
	docker-compose down

# Setup database (requires running PostgreSQL)
db-setup:
	psql -U gym_admin -d gym_system -f backend/db/schema.sql
	psql -U gym_admin -d gym_system -f backend/db/seed.sql

# PM2 production launch
pm2-start:
	pm2 start pm2.config.js

pm2-stop:
	pm2 stop all

pm2-logs:
	pm2 logs
