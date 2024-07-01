# scrapbook-core
 
This repo is responsible for the data management, combination, and analysis of scraps / hypercards stored by EJ Fox.

The main purpose of the repo to is to accumulate all of the digital ephemera I cast off each day:
- Pinboard booksmarks
- Mastodon posts
- GitHub stars, issues, pull requests, and gists
- Are.na blocks and channels

Each of these are stored as "scraps", given a unique ID, and then stored in the database. Scraps can be threaded together, and there are a few tools to aid in the summarization, tagging, and entity extraction to make it easier to find relevant information later. 

## Overview
This script fetches data from various sources (Pinboard, Mastodon, Are.na, and GitHub), processes it, and upserts it into a Supabase database. It also generates summaries, extracts locations, and creates screenshots for certain types of content.

## Main Components

![Flow diagram](http://res.cloudinary.com/ejf/image/upload/v1719800138/Screenshot_2024-06-30_at_10.15.26_PM.png)

1. **Imports**: The script imports various modules and functions from other files.

2. **Constants and Configurations**:
   - `CHECKPOINT_FILE`: Keeps track of the last fetch time for each source.
   - `supabase`: Supabase client for database operations.
   - `limiter`, `upsertLimiter`, `browserLimiter`: Rate limiters for different operations.

3. **Checkpoint Management**:
   - `loadCheckpoint()`: Loads the last fetch times from the checkpoint file.
   - `saveCheckpoint()`: Saves the current fetch times to the checkpoint file.

4. **Main Functions**:
   - `fetchAndUpsertScraps()`: Orchestrates the fetching and upserting of data from all sources.
   - `upsertScrap()`: Upserts a single scrap into the Supabase database.

5. **Source-specific Functions**:
   - `fetchAndUpsertPinboardBookmarks()`: Handles Pinboard bookmarks.
   - `fetchAndUpsertGithubData()`: Handles GitHub data (repos, issues, gists).
   - `fetchAndUpsertMastodonStatuses()`: Handles Mastodon statuses.
   - `fetchAndUpsertArenaBlocks()`: Handles Are.na blocks.

6. **Helper Functions**:
   - `generateWebpageScreenshot()`: Creates screenshots of webpages.
   - `cleanAndFormatFilename()`: Cleans and formats filenames for storage.
   - `splitQueryParams()`: Splits URL query parameters.

7. **Main Execution**:
   - `main()`: The entry point of the script, which calls `fetchAndUpsertScraps()`.

## Flow of Execution

1. Load the checkpoint file to determine the last fetch time for each source.
2. For each source (Pinboard, Mastodon, Are.na, GitHub):
   a. Fetch new data since the last checkpoint.
   b. Process each item:
      - Generate summaries (for Pinboard).
      - Extract locations and relationships (for Pinboard).
      - Create screenshots (for Pinboard and Are.na).
      - Format data into a consistent structure.
   c. Upsert processed data into the Supabase database.
3. Update the checkpoint file with the new fetch times.

## Rate Limiting
Different rate limiters are used to prevent overwhelming external APIs and local resources:
- `limiter`: For local API requests and upserts.
- `upsertLimiter`: For summary generation.
- `browserLimiter`: For browser requests and headless Chrome instances.