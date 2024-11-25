# Scrapbook Core

Scrapbook Core is a comprehensive data management system designed to accumulate and analyze digital ephemera from various sources. It serves as a personal knowledge management tool, capturing and organizing daily digital interactions across multiple platforms.

<img width="1912" alt="Screenshot 2024-07-07 at 10 02 54 PM" src="https://github.com/ejfox/scrapbook-core/assets/530073/614513b9-c85c-4815-8a24-e2c43cf5dad4">


## Features

- Fetches data from multiple sources:
  - Pinboard bookmarks
  - Mastodon posts
  - GitHub activities (stars, issues, pull requests, gists)
  - Are.na blocks and channels
- Processes and stores data as "scraps" with unique IDs
- Generates summaries and extracts entities for easy retrieval
- Uploads screenshots to Supabase or Cloudinary and stores URLs
- Syncs data with both Supabase and SQLite databases
- Includes an Alfred Workflow for quick local database searches

Can be accessed through the command-line [scrapbook-cli](https://github.com/ejfox/scrapbook-cli) tool.

Also visible on [my website's scrapbook](https://ejfox.com/scrapbook/)

I also use it in combination with an Alfred Workflow and a local SQLite database for quick searching:
- `<scripts/setup_sqlite.mjs>`
- `<scripts/sync_supabase_to_sqlite.js>`
- `<scripts/search_sqlite_scraps.js>`
- `<Local Scrap Search.1.1.alfredworkflow.zip>`

## Deploying
`flyctl deploy`

### Running
`flyctl ssh console -C "node scripts/index.mjs --all"`

### Get logs
`flyctl logs`

## Database Schema

### Scraps table
```sql
public.scraps (
  id uuid not null default gen_random_uuid (),
  content text null default ''::text,
  summary text null,
  created_at timestamp without time zone null default current_timestamp,
  updated_at timestamp without time zone null default current_timestamp,
  tags jsonb null,
  relationships jsonb null,
  metadata jsonb null,
  scrap_id text null,
  embedding public.vector null,
  graph_imported boolean null default false,
  url text null,
  screenshot_url text null,
  location text null,
  title text null,
  latitude double precision null,
  longitude double precision null,
  type text null default 'unknown'::text,
  published_at timestamp without time zone null,
  shared boolean null default false,
  embedding_nomic public.vector null,
  image_embedding public.vector null,
  processing_instance_id text null,
  processing_started_at timestamp without time zone null,
  source public.scrap_source null default 'lock'::scrap_source,
  constraint scraps_pkey primary key (id),
  constraint scraps_id_key unique (id),
  constraint scraps_scrap_id_key unique (scrap_id)
) tablespace pg_default;
```


## System Architecture

```mermaid
graph TD
    A[Data Sources] --> B[Fetchers]
    B --> C[Processors]
    C --> D[Storage]
    D --> E[Supabase]
    D --> F[SQLite]
    G[AI Services] --> C
    H[Screenshot Service] --> C
    F --> I[Alfred Workflow]
```

## Key Components

1. **Data Fetchers**: Modules for each data source (e.g., `dl_pinboard.mjs`, `dl_mastodon.mjs`).  These modules handle the retrieval of data from external APIs.
2. **Processors**: Modules that process the raw data from the fetchers.  This includes:
   - `aiSummarization.js`: Generates summaries and tags using AI.
   - `aiGeolocation.mjs`: Extracts location data from text content.
   - `aiRelationshipExtraction.mjs`: Identifies relationships between different scraps.
3. **Storage**:  Handles persistence of processed data.
   - `index.mjs`: The main script orchestrating data fetching, processing, and storage in Supabase.
   - `sync_supabase_to_sqlite.js`: Synchronizes data between Supabase and a local SQLite database.
4. **Utilities**: Helper functions and modules.
   - `helpers.js`: Common utility functions.
   - `manifestHelpers.mjs`: Manages a manifest file for tracking data fetch operations.
5. **Alfred Workflow**: Enables quick searching of the local SQLite database.

## Files

- `index.mjs`: Main script orchestrating data flow.
- `sync_supabase_to_sqlite.js`: Syncs Supabase data to local SQLite.
- `aiSummarization.js`: AI-powered summarization and tag generation.
- `dl_pinboard.mjs`: Pinboard bookmark fetching and processing.
- `dl_mastodon.mjs`: Mastodon status retrieval and processing.
- `dl_arena.mjs`: Are.na block and channel fetching and processing.
- `dl_github.mjs`: GitHub data (repos, issues, PRs, gists) retrieval and processing.
- `aiGeolocation.mjs`: Location data extraction from text.
- `aiRelationshipExtraction.mjs`: Relationship identification between scraps.
- `helpers.js`: General utility functions.
- `manifestHelpers.mjs`: Manages data fetch manifests.
- `alfred_search.js`: Alfred Workflow search script.
- `Scrapbook Search.alfredworkflow`: Alfred Workflow (zip file).

## Setup

1. Clone the repository.
2. Install dependencies: `npm install`.
3. Set up environment variables (see "Setting Up Credentials" below).
4. Run the main script: `node index.mjs`.
5. Install the Alfred Workflow (unzip and double-click the `.alfredworkflow` file).

## Usage

- Fetch all data: `node index.mjs --all`
- Fetch specific sources: `node index.mjs --[source]` (e.g., `--pinboard`, `--mastodon`)
- Sync to SQLite: `node sync_supabase_to_sqlite.js`
- Search scraps using Alfred (keyword: `sc`).

## Data Flow

1. Data is fetched from various sources.
2. Each item is processed: summaries are generated, locations and relationships are extracted, and screenshots are created (where applicable).
3. Processed data is upserted into Supabase.
4. Data is synced to a local SQLite database for offline access.
5. The local SQLite database can be searched quickly using the Alfred Workflow.

## Alfred Workflow

The Alfred Workflow enables quick searching of the local SQLite database.  It displays title, summary, and age, with quick actions to open URLs, view full content, or copy formatted scraps.

## Setting Up Credentials

This project requires several API keys and secrets.  Store these securely in a `.env` file *in your local repository only*.  **Do not commit your `.env` file to version control.**  Use the `.env-example` file as a template.

| Environment Variable        | Description                                                                     | Source                                                                          |
|-----------------------------|---------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| `GITHUB_TOKEN`              | GitHub Personal Access Token (repo, read:user, gist scopes)                     | [GitHub Personal Access Tokens](https://github.com/settings/tokens)                 |
| `GITHUB_USERNAME`           | Your GitHub username                                                              |                                                                                   |
| `PINBOARD_TOKEN`            | Your Pinboard API token                                                            | [Pinboard Settings](https://pinboard.in/settings/password)                         |
| `ARENA_ACCESS_TOKEN`        | Your Are.na API token                                                             | [Are.na Developer Settings](https://dev.are.na/oauth/applications)                 |
| `USER_SLUG`                 | Your Are.na username                                                              |                                                                                   |
| `MASTODON_ACCESS_TOKEN`     | Your Mastodon API token                                                            | Your Mastodon instance's developer settings                                        |
| `MASTODON_API_URL`          | Your Mastodon instance URL (e.g., `https://mastodon.social`)                     | Your Mastodon instance's developer settings                                        |
| `SUPABASE_URL`              | Your Supabase project URL                                                         | Your Supabase project settings                                                    |
| `SUPABASE_KEY`              | Your Supabase anon key                                                            | Your Supabase project settings                                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (required for database operations)               | Your Supabase project settings                                                    |
| `CLOUDINARY_CLOUD_NAME`     | Your Cloudinary cloud name                                                        | Your Cloudinary account settings                                                  |
| `CLOUDINARY_API_KEY`        | Your Cloudinary API key                                                           | Your Cloudinary account settings                                                  |
| `CLOUDINARY_API_SECRET`     | Your Cloudinary API secret                                                       | Your Cloudinary account settings                                                  |
| `OPENROUTER_API_KEY`        | OpenRouter API key (for AI summarization)                                      | OpenRouter account settings                                                       |
| `OPENCAGE_API_KEY`          | OpenCage Geocoding API key (for location extraction)                             | [OpenCage Data](https://opencagedata.com/)                                      |


## Rate Limiting and Caching

The application employs rate limiting using the `Bottleneck` library to avoid exceeding API limits.  Caching is used to reduce the number of API calls and improve performance.  The cache is stored locally in the `./data` directory.

## AI Services

The application utilizes AI services for tasks such as summarization and embedding generation.  Currently, OpenAI's `text-embedding-ada-002` model is used for embeddings.  The `OPENROUTER_API_KEY` is required for AI summarization.  Costs associated with these services are the responsibility of the user.

## Error Handling and Logging

The application includes comprehensive error handling and logging.  Errors are logged to the console, and detailed error messages are provided to aid in troubleshooting.

## Deployment (Fly.io)

This application is designed for deployment on Fly.io.  You will need a Fly.io account.  After setting up your environment variables, deploy using `flyctl deploy`.  The `fly.toml` file configures the application for multi-region deployment and health checks.

## Validation Tools

The project includes two validation utilities:

### Scrap Validation (`validate_scraps.mjs`)

This script validates the structure and content of scraped data, checking for missing fields, incorrect data types, and invalid formats.  It provides detailed error reporting and performance benchmarking.  Run it with `node scripts/validate_scraps.mjs [source]` (e.g., `node scripts/validate_scraps.mjs pinboard`).

### AI Service Validation (`validate_ai.mjs`)

This script tests the AI-powered features (summarization, geolocation, relationship extraction) using sample data.  Run it with `node scripts/validate_ai.mjs [test_name]` (e.g., `node scripts/validate_ai.mjs summarization`).

## Database Maintenance

Regularly run `node scripts/validate_db_integrity.mjs` to check for and clean up any orphaned or stuck processing records in the database.