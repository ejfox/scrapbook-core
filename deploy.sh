#!/bin/bash

# Scrapbook Core Deployment Script
# This script simplifies the deployment process for VPS hosting

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
}

# Check if .env file exists
check_env() {
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        cp .env.production.example .env
        print_info "Please edit .env file with your actual configuration:"
        print_info "  nano .env"
        print_info "Then run this script again."
        exit 1
    fi
}

# Validate required environment variables
validate_env() {
    source .env 2>/dev/null || true
    
    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
        print_error "SUPABASE_URL and SUPABASE_KEY are required in .env file"
        exit 1
    fi
    
    print_success "Environment configuration validated"
}

# Create necessary directories
create_directories() {
    print_info "Creating necessary directories..."
    mkdir -p data logs temp screenshots
    chmod 755 data logs temp screenshots
    print_success "Directories created"
}

# Build and start the application
deploy() {
    print_info "Building and starting Scrapbook Core..."
    
    # Stop existing containers
    docker-compose down 2>/dev/null || true
    
    # Build the image
    docker-compose build --no-cache
    
    # Start the services
    docker-compose up -d
    
    print_success "Scrapbook Core deployed successfully!"
}

# Check deployment status
check_status() {
    print_info "Checking deployment status..."
    
    # Wait a moment for containers to start
    sleep 5
    
    if docker-compose ps | grep -q "Up"; then
        print_success "Container is running"
        docker-compose ps
    else
        print_error "Container is not running. Check logs:"
        docker-compose logs --tail=20
        exit 1
    fi
}

# Main deployment process
main() {
    print_info "Starting Scrapbook Core deployment..."
    
    check_docker
    check_env
    validate_env
    create_directories
    deploy
    check_status
    
    print_success "Deployment completed successfully!"
    print_info ""
    print_info "Next steps:"
    print_info "  - View logs: docker-compose logs -f"
    print_info "  - Check status: docker-compose ps"
    print_info "  - Update: ./deploy.sh --update"
    print_info "  - Stop: docker-compose down"
}

# Handle command line arguments
case "${1:-}" in
    --update)
        print_info "Updating Scrapbook Core..."
        git pull
        docker-compose down
        docker-compose build --no-cache
        docker-compose up -d
        print_success "Update completed!"
        ;;
    --stop)
        print_info "Stopping Scrapbook Core..."
        docker-compose down
        print_success "Stopped!"
        ;;
    --logs)
        docker-compose logs -f
        ;;
    --status)
        docker-compose ps
        ;;
    --restart)
        print_info "Restarting Scrapbook Core..."
        docker-compose restart
        print_success "Restarted!"
        ;;
    --help)
        echo "Scrapbook Core Deployment Script"
        echo ""
        echo "Usage: $0 [OPTION]"
        echo ""
        echo "Options:"
        echo "  (no option)  Deploy the application"
        echo "  --update     Update and redeploy"
        echo "  --stop       Stop the application"
        echo "  --restart    Restart the application"
        echo "  --logs       View application logs"
        echo "  --status     Check deployment status"
        echo "  --help       Show this help message"
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown option: $1"
        print_info "Use --help for available options"
        exit 1
        ;;
esac