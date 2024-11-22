import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { subDays } from "date-fns";
import { generateScrapId } from '../helpers.js';
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const username = process.env.GITHUB_USERNAME || "ejfox";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error("GITHUB_TOKEN is not set in environment variables");
  process.exit(1);
}

const octokit = new Octokit({
  auth: token,
  userAgent: `${username}-scrapbook`,
  previews: ["mercy-preview"],
});

const INSTANCE_NAME = process.env.INSTANCE_NAME || 
  `${process.env.NODE_ENV || 'dev'}-github-${Date.now()}`;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    db: { schema: 'public' }
  }
);

// Process different GitHub item types
export async function processGithubItem(item, type) {
  if (!item || !item.id) {
    console.error('Invalid GitHub item:', type);
    return null;
  }

  const scrapId = `github-${item.id}`;
  
  try {
    // Try to claim the item first
    const { data: claim } = await supabase
      .from('scraps')
      .update({
        processing_instance_id: INSTANCE_NAME,
        processing_started_at: new Date().toISOString()
      })
      .eq('scrap_id', scrapId)
      .is('processing_instance_id', null)
      .select()
      .single();

    if (!claim) {
      console.log(`Skipping GitHub item ${item.id} - already being processed`);
      return null;
    }

    try {
      // Get best available URL
      const url = item.html_url || item.url;
      
      // Get best available content
      const content = (() => {
        switch(type) {
          case 'repo':
            return item.description || 'No description';
          case 'pr':
          case 'issue':
            return item.body || 'No content';
          case 'gist':
            return item.description || 'No description';
          case 'release':
            return item.body || 'No content';
          case 'starred':
            return item.description || 'No description';
          default:
            return 'No content';
        }
      })();

      // Combine all possible tags
      const tags = [
        // Repository topics (if available)
        ...(item.topics || []),
        // Language as a tag
        item.language?.toLowerCase(),
        // Item type
        type,
        // Status tags for PRs/Issues
        ...(type === 'pr' || type === 'issue' ? [item.state] : []),
        // Visibility
        ...(type === 'repo' || type === 'gist' ? [item.private ? 'private' : 'public'] : []),
        // Fork status
        ...(type === 'repo' && item.fork ? ['fork'] : [])
      ].filter(Boolean);

      return {
        scrap_id: scrapId,
        id: generateScrapId('github', item.id),
        source: "github",
        type,
        url,
        title: item.title || item.name || 'Untitled',
        content,
        screenshot_url: null,  // GitHub items don't need screenshots
        published_at: item.created_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        shared: false,  // Default to false
        tags: [...new Set(tags)], // Deduplicate tags
        metadata: {
          // Store original topics separately
          topics: item.topics || [],
          language: item.language,
          // Type-specific metadata
          ...(type === 'repo' && {
            stargazers_count: item.stargazers_count,
            forks_count: item.forks_count,
            is_fork: item.fork,
            default_branch: item.default_branch,
            homepage: item.homepage
          }),
          ...(type === 'pr' && {
            comments: item.comments,
            labels: item.labels?.map(l => l.name),
            changed_files: item.changedFiles,
            repo: {
              name: item.repo?.name,
              full_name: item.repo?.full_name
            }
          }),
          ...(type === 'issue' && {
            comments: item.comments,
            labels: item.labels?.map(l => l.name),
            repo: {
              name: item.repo?.name,
              full_name: item.repo?.full_name
            }
          }),
          ...(type === 'gist' && {
            files: Object.keys(item.files || {}),
            public: item.public
          }),
          ...(type === 'starred' && {
            starred_at: item.starred_at,
            language: item.language,
            stargazers_count: item.stargazers_count,
            forks_count: item.forks_count
          })
        }
      };
    } finally {
      // Release claim
      await supabase
        .from('scraps')
        .update({
          processing_instance_id: null,
          processing_started_at: null
        })
        .eq('scrap_id', scrapId);
    }
  } catch (error) {
    console.error(`Error processing GitHub ${type}:`, error);
    // Release claim on error
    await supabase
      .from('scraps')
      .update({
        processing_instance_id: null,
        processing_started_at: null
      })
      .eq('scrap_id', scrapId);
    return null;
  }
}

export const fetchGithubData = async (testMode = false) => {
  console.log("Initializing GitHub data download...");
  const sinceDate = subDays(new Date(), testMode ? 7 : 60).toISOString();

  try {
    // Fetch all data types
    const [userGists, userRepos, userReleases, userPRs, starredRepos, userIssues] = 
      await Promise.all([
        octokit.gists.listForUser({ username }),
        octokit.repos.listForUser({
          username,
          type: "owner",
          sort: "updated",
          direction: "desc",
          per_page: testMode ? 5 : 25,
          since: sinceDate,
        }),
        octokit.search.issuesAndPullRequests({
          q: `author:${username} is:public type:release updated:>${sinceDate}`,
        }),
        octokit.search.issuesAndPullRequests({
          q: `author:${username} is:public type:pr updated:>${sinceDate}`,
        }),
        octokit.activity.listReposStarredByUser({
          username,
          per_page: testMode ? 5 : 100,
          sort: "created",
          direction: "desc",
          since: sinceDate,
        }),
        octokit.search.issuesAndPullRequests({
          q: `author:${username} is:public updated:>${sinceDate}`,
        }),
      ]);

    // Process each type
    return {
      userGists: await Promise.all(userGists.data.map(g => processGithubItem(g, 'gist'))),
      userRepos: await Promise.all(userRepos.data.map(r => processGithubItem(r, 'repo'))),
      userReleases: await Promise.all(userReleases.data.items.map(r => processGithubItem(r, 'release'))),
      userPRs: await Promise.all(userPRs.data.items.map(p => processGithubItem(p, 'pr'))),
      starredRepos: await Promise.all(starredRepos.data.map(s => processGithubItem(s, 'starred'))),
      userIssues: await Promise.all(userIssues.data.items.map(i => processGithubItem(i, 'issue')))
    };

  } catch (error) {
    console.error("Error fetching GitHub data:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    return {
      userGists: [],
      userRepos: [],
      userIssues: [],
      userReleases: [],
      userPRs: [],
      starredRepos: []
    };
  }
};

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchGithubData()
    .then((data) => {
      console.log("GitHub data fetched successfully");
      console.log(`Repos: ${data.userRepos.length}`);
      console.log(`PRs: ${data.userPRs.length}`);
      console.log(`Issues: ${data.userIssues.length}`);
      console.log(`Gists: ${data.userGists.length}`);
      console.log(`Releases: ${data.userReleases.length}`);
      console.log(`Starred Repos: ${data.starredRepos.length}`);
    })
    .catch((error) => {
      console.error("Error in main execution:", error);
      process.exit(1);
    });
}
