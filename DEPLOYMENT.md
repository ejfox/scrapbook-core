# Scrapbook Core - VPS Deployment Guide

This guide will help you deploy Scrapbook Core on any VPS using Docker.

## Prerequisites

- VPS with at least 2GB RAM and 1 CPU core
- Docker and Docker Compose installed
- Domain name (optional, for web interface)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/scrapbook-core.git
cd scrapbook-core
```

### 2. Configure Environment

Copy the production environment template:

```bash
cp .env.production.example .env
```

Edit `.env` with your actual API keys and database credentials:

```bash
nano .env
```

**Required Settings:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_KEY` - Your Supabase anon key

**Optional but Recommended:**
- `PINBOARD_TOKEN` - For bookmark synchronization
- `OPENROUTER_API_KEY` - For AI summarization
- `NOMIC_API_KEY` - For text embeddings
- `CLOUDINARY_*` - For screenshot storage

### 3. Deploy with Docker Compose

```bash
# Build and start the application
docker-compose up -d

# Check logs
docker-compose logs -f

# Check health status
docker-compose ps
```

### 4. Verify Deployment

```bash
# Check if container is running
docker ps

# View application logs
docker logs scrapbook-core

# Check health endpoint (if API server is enabled)
curl http://localhost:3000/health
```

## Configuration Options

### Docker Compose Customization

Edit `docker-compose.yml` to customize:

- **Resource limits**: Adjust memory and CPU limits
- **Port mapping**: Change exposed ports
- **Volume mounts**: Modify data persistence paths
- **Environment variables**: Override default settings

### Scheduling Options

#### Option 1: Docker Compose with Cron-like Execution

Create a separate compose file for scheduled runs:

```yaml
# docker-compose.cron.yml
version: '3.8'
services:
  scrapbook-cron:
    image: scrapbook-core:latest
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    command: ["node", "scripts/index.mjs", "--all", "--new-only"]
    restart: "no"
```

Run with:
```bash
docker-compose -f docker-compose.cron.yml run --rm scrapbook-cron
```

#### Option 2: System Cron

Add to your system crontab (`crontab -e`):

```bash
# Run every 4 hours
0 */4 * * * cd /path/to/scrapbook-core && docker-compose -f docker-compose.cron.yml run --rm scrapbook-cron

# Run database cleanup daily
0 2 * * * cd /path/to/scrapbook-core && docker-compose exec scrapbook-core node scripts/validate_db_integrity.mjs
```

## Advanced Configuration

### Custom Commands

Override the default command in docker-compose.yml:

```yaml
services:
  scrapbook-core:
    # ... other config
    command: ["node", "scripts/index.mjs", "--pinboard", "--new-only"]
```

Available command options:
- `--all` - Process all sources
- `--pinboard` - Process Pinboard bookmarks only
- `--github` - Process GitHub activity only
- `--mastodon` - Process Mastodon posts only
- `--arena` - Process Are.na blocks only
- `--new-only` - Only process new items (skip existing)

### Volume Mounts

```yaml
volumes:
  # Data persistence
  - ./data:/app/data
  
  # Log files
  - ./logs:/app/logs
  
  # Custom configuration
  - ./config:/app/config
  
  # Screenshots (if not using Cloudinary)
  - ./screenshots:/app/screenshots
```

### Resource Limits

For VPS with limited resources:

```yaml
deploy:
  resources:
    limits:
      memory: 1G      # Reduce for smaller VPS
      cpus: '0.5'     # Reduce for shared CPU
    reservations:
      memory: 256M
      cpus: '0.25'
```

## Monitoring and Maintenance

### Health Checks

The container includes a health check. Monitor with:

```bash
# Check health status
docker inspect scrapbook-core | grep Health

# View detailed health logs
docker inspect scrapbook-core --format='{{json .State.Health}}'
```

### Log Management

Logs are automatically rotated. View logs:

```bash
# Follow real-time logs
docker-compose logs -f

# View specific service logs
docker-compose logs scrapbook-core

# View last 100 lines
docker-compose logs --tail=100 scrapbook-core
```

### Updates

To update the application:

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Backup

Backup important data:

```bash
# Backup data directory
tar -czf backup-$(date +%Y%m%d).tar.gz data/ logs/ .env

# Backup database (if using local database)
# This depends on your database setup
```

## Troubleshooting

### Container Won't Start

```bash
# Check container logs
docker logs scrapbook-core

# Check Docker Compose logs
docker-compose logs

# Verify environment variables
docker-compose config
```

### Memory Issues

If experiencing out-of-memory errors:

1. Reduce resource limits in docker-compose.yml
2. Enable swap on your VPS
3. Process sources individually instead of `--all`

```yaml
# Lower memory limits
deploy:
  resources:
    limits:
      memory: 512M
```

### Permission Issues

```bash
# Fix ownership of data directories
sudo chown -R 1001:1001 data/ logs/

# Or use current user
sudo chown -R $USER:$USER data/ logs/
```

### Network Issues

```bash
# Test container connectivity
docker exec scrapbook-core ping google.com

# Check DNS resolution
docker exec scrapbook-core nslookup google.com
```

## Security Considerations

1. **Environment Variables**: Keep `.env` secure and never commit it
2. **Firewall**: Only expose necessary ports (3000 for API if needed)
3. **Updates**: Regularly update the container and host system
4. **SSL**: Use a reverse proxy (nginx) with SSL for web interfaces
5. **Backup**: Regularly backup your data and configuration

## Performance Tips

1. **Resource Allocation**: Allocate adequate RAM (2GB+ recommended)
2. **Storage**: Use SSD storage for better database performance
3. **Scheduling**: Avoid running all sources simultaneously on resource-constrained systems
4. **Caching**: Consider enabling Redis for caching (uncomment in docker-compose.yml)

## Support

- Check the logs first: `docker-compose logs`
- Verify your `.env` configuration
- Ensure all required services (Supabase) are accessible
- Check system resources: `htop` or `docker stats`

For additional support, check the project repository or documentation.