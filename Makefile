# Scrapbook Core - Docker Deployment Makefile

.PHONY: help build deploy start stop restart logs status clean update test

# Default target
help:
	@echo "Scrapbook Core - Available Commands:"
	@echo ""
	@echo "  make deploy     - Deploy the application (build + start)"
	@echo "  make build      - Build the Docker image"
	@echo "  make start      - Start the application"
	@echo "  make stop       - Stop the application"
	@echo "  make restart    - Restart the application"
	@echo "  make logs       - View application logs"
	@echo "  make status     - Check deployment status"
	@echo "  make update     - Update and redeploy"
	@echo "  make clean      - Remove containers and images"
	@echo "  make test       - Run a test deployment"
	@echo ""

# Build the Docker image
build:
	@echo "Building Scrapbook Core image..."
	docker-compose build --no-cache

# Deploy (build and start)
deploy: build start
	@echo "Deployment completed!"

# Start the application
start:
	@echo "Starting Scrapbook Core..."
	docker-compose up -d

# Stop the application
stop:
	@echo "Stopping Scrapbook Core..."
	docker-compose down

# Restart the application
restart:
	@echo "Restarting Scrapbook Core..."
	docker-compose restart

# View logs
logs:
	docker-compose logs -f

# Check status
status:
	docker-compose ps

# Update and redeploy
update:
	@echo "Updating Scrapbook Core..."
	git pull
	docker-compose down
	docker-compose build --no-cache
	docker-compose up -d
	@echo "Update completed!"

# Clean up containers and images
clean:
	@echo "Cleaning up Docker resources..."
	docker-compose down -v
	docker image prune -f
	docker container prune -f

# Test deployment with limited resources
test:
	@echo "Running test deployment..."
	docker-compose -f docker-compose.yml -f docker-compose.test.yml up -d
	
# Development mode (with live reloading)
dev:
	@echo "Starting in development mode..."
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Check environment configuration
check-env:
	@if [ ! -f .env ]; then \
		echo "❌ .env file not found"; \
		echo "📋 Copy from template: cp .env.production.example .env"; \
		exit 1; \
	else \
		echo "✅ .env file exists"; \
	fi

# Backup data
backup:
	@echo "Creating backup..."
	tar -czf backup-$$(date +%Y%m%d-%H%M%S).tar.gz data/ logs/ .env
	@echo "Backup created: backup-$$(date +%Y%m%d-%H%M%S).tar.gz"

# Quick setup for new deployment
setup: check-env
	@echo "Setting up Scrapbook Core..."
	mkdir -p data logs temp screenshots
	chmod 755 data logs temp screenshots
	@echo "Setup completed! Run 'make deploy' to start."