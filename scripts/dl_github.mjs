import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { subDays } from "date-fns";
import { generateScrapId } from '../helpers.js';
import { generateScreenshot } from './generateScreenshot.mjs';

dotenv.config();

const username = "ejfox";
const token = process.env.GITHUB_TOKEN;
const FETCH_DAYS = 60;

const octokit = new Octokit({
  auth: token,
  userAgent: `${username}-scrapbook`,
  previews: ["mercy-preview"],
});

// Process different GitHub item types
export async function processGithubItem(item, type) {
  const shortId = generateScrapId('github', item.id).substring(0, 8);
  
  // Generate screenshot based on type
  const screenshot_url = await (async () => {
    switch(type) {
      case 'repo':
        return item.html_url ? 
          await generateScreenshot({
            source: 'github',
            shortId,
            url: item.html_url
          }) : null;
      case 'pr':
      case 'issue':
        return item.html_url ?
          await generateScreenshot({
            source: 'github',
            shortId,
            url: item.html_url
          }) : null;
      default:
        return null;
    }
  })();

  const baseFields = {
    id: generateScrapId('github', item.id),
    source: "github",
    type,
    url: item.html_url,
    title: item.title || item.name || item.description,
    content: item.body || item.description || '',
    published_at: item.created_at,
    created_at: item.created_at,
    updated_at: item.updated_at,
    shared: !item.private,
    tags: item.topics || [],
    screenshot_url,
  };

  // Type-specific processing
  switch(type) {
    case 'repo':
      return {
        ...baseFields,
        metadata: {
          language: item.language,
          stargazers_count: item.stargazers_count,
          forks_count: item.forks_count,
          readme: item.readme,
          is_fork: item.fork,
          default_branch: item.default_branch,
          homepage: item.homepage
        }
      };
      
    case 'pr':
      return {
        ...baseFields,
        metadata: {
          state: item.state,
          comments: item.comments,
          labels: item.labels?.map(l => l.name),
          changed_files: item.changedFiles,
          repo: {
            name: item.repo?.name,
            full_name: item.repo?.full_name
          }
        }
      };
      
    case 'issue':
      return {
        ...baseFields,
        metadata: {
          state: item.state,
          comments: item.comments,
          labels: item.labels?.map(l => l.name),
          repo: {
            name: item.repo?.name,
            full_name: item.repo?.full_name
          }
        }
      };
      
    case 'gist':
      return {
        ...baseFields,
        metadata: {
          files: item.files,
          public: item.public,
          description: item.description
        }
      };
      
    case 'release':
      return {
        ...baseFields,
        metadata: {
          tag_name: item.tag_name,
          prerelease: item.prerelease,
          draft: item.draft,
          repo: {
            name: item.repo?.name,
            full_name: item.repo?.full_name
          }
        }
      };
      
    case 'starred':
      return {
        ...baseFields,
        metadata: {
          language: item.language,
          stargazers_count: item.stargazers_count,
          forks_count: item.forks_count,
          starred_at: item.starred_at
        }
      };
      
    default:
      return baseFields;
  }
}

export const fetchGithubData = async () => {
  console.log("Initializing GitHub data download...");
  const sinceDate = subDays(new Date(), FETCH_DAYS).toISOString();

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
          per_page: 25,
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
          per_page: 100,
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

// Helper function to get README content
export async function getRepoReadme(owner, repo) {
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error) {
    console.error("Error fetching repo README:", error.message);
    return null;
  }
}

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
