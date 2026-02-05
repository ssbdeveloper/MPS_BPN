#!/bin/bash

# MPS2 Timesheet Deployment Script
# Usage: ./deploy.sh [command]

set -e

COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
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

# Check if .env exists
check_env() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found!"
        print_info "Please create .env file with required variables"
        exit 1
    fi
    print_success ".env file found"
}

# Build all services
build_all() {
    print_info "Building all services..."
    docker compose build
    print_success "All services built successfully"
}

# Build specific service
build_service() {
    local service=$1
    if [ -z "$service" ]; then
        print_error "Please specify service name"
        echo "Available services: db, api, frontend, nginx, sow_exporter"
        exit 1
    fi
    print_info "Building $service..."
    docker compose build "$service"
    print_success "$service built successfully"
}

# Start all services
start_all() {
    print_info "Starting all services..."
    docker compose up -d
    print_success "All services started"
    docker compose ps
}

# Stop all services
stop_all() {
    print_info "Stopping all services..."
    docker compose down
    print_success "All services stopped"
}

# Restart service
restart_service() {
    local service=$1
    if [ -z "$service" ]; then
        print_error "Please specify service name"
        exit 1
    fi
    print_info "Restarting $service..."
    docker compose restart "$service"
    print_success "$service restarted"
}

# View logs
view_logs() {
    local service=$1
    if [ -z "$service" ]; then
        print_info "Showing all logs (Ctrl+C to exit)..."
        docker compose logs -f
    else
        print_info "Showing logs for $service (Ctrl+C to exit)..."
        docker compose logs -f "$service"
    fi
}

# Check status
check_status() {
    print_info "Container status:"
    docker compose ps
    echo ""
    print_info "Resource usage:"
    docker stats --no-stream
}

# Update frontend
update_frontend() {
    print_info "Updating React frontend..."
    docker compose build --no-cache frontend
    docker compose up -d frontend
    print_success "Frontend updated successfully"
}

# Update API
update_api() {
    print_info "Updating API..."
    docker compose build --no-cache api
    docker compose up -d api
    print_success "API updated successfully"
}

# Backup database
backup_db() {
    local backup_file="backups/backup_$(date +%Y%m%d_%H%M%S).sql"
    print_info "Creating database backup..."
    mkdir -p backups
    docker exec timesheet-db pg_dump -U timesheet_user timesheet_db > "$backup_file"
    print_success "Backup created: $backup_file"
}

# Clean up
cleanup() {
    print_warning "This will remove stopped containers, unused networks, and dangling images"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cleaning up..."
        docker system prune -f
        print_success "Cleanup completed"
    else
        print_info "Cleanup cancelled"
    fi
}

# Show help
show_help() {
    cat << EOF
MPS2 Timesheet Deployment Script

Usage: ./deploy.sh [command]

Commands:
    build               Build all services
    build [service]     Build specific service (api, frontend, nginx, etc.)
    start               Start all services
    stop                Stop all services
    restart [service]   Restart specific service
    logs [service]      View logs (all or specific service)
    status              Check container status and resource usage
    update-frontend     Update React frontend (rebuild & restart)
    update-api          Update API (rebuild & restart)
    backup              Backup database
    cleanup             Clean up unused Docker resources
    help                Show this help message

Examples:
    ./deploy.sh build frontend       # Build only frontend
    ./deploy.sh start                # Start all services
    ./deploy.sh logs api             # View API logs
    ./deploy.sh update-frontend      # Update frontend after code changes
    ./deploy.sh backup               # Backup database

Note: This script uses 'docker compose' (v2) command
EOF
}

# Main script logic
case "$1" in
    build)
        check_env
        if [ -z "$2" ]; then
            build_all
        else
            build_service "$2"
        fi
        ;;
    start)
        check_env
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_service "$2"
        ;;
    logs)
        view_logs "$2"
        ;;
    status)
        check_status
        ;;
    update-frontend)
        update_frontend
        ;;
    update-api)
        update_api
        ;;
    backup)
        backup_db
        ;;
    cleanup)
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
