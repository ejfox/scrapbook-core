import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { subDays } from "date-fns";

dotenv.config();

const username = "ejfox";
const token = process.env.GITHUB_TOKEN;
const FETCH_DAYS = 60;

const octokit = new Octokit({
  auth: token,
  userAgent: `${username}-scrapbook`,
  previews: ["mercy-preview"],
});

const extractMediaUrl = (text) => {
  const urls = [];
  if (!text) return urls;

  const decodedText = decodeURIComponent(text);

  console.log(`Extracting media URLs from text: ${decodedText}`);

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const markdownImageRegex = /!\[[^\]]*\]\((https?:\/\/[^\s]+)\)/g;
  const htmlImageRegex = /<img [^>]*src="(https?:\/\/[^"]+)"/g;

  [urlRegex, markdownImageRegex, htmlImageRegex].forEach((regex) => {
    let match;
    while ((match = regex.exec(decodedText))) {
      const url = match[1] || match[0];
      if (/\.(png|jpe?g|gif|mp4|webm)$/i.test(url) || /\/assets\//.test(url)) {
        console.log(`Found media URL: ${url}`);
        urls.push(url);
      }
    }
  });

  return urls;
};

export const fetchGithubData = async () => {
  console.log("Initializing GitHub data download...");

  const sinceDate = subDays(new Date(), FETCH_DAYS).toISOString();
  console.log(`Fetching data since: ${sinceDate}`);

  try {
    const [
      userGists,
      userRepos,
      userReleases,
      userPRs,
      starredRepos,
      userIssues,
    ] = await Promise.all([
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

    console.log("Downloaded GitHub data");

    const enhancedUserRepos = await Promise.all(
      userRepos.data.map(async (repo) => {
        try {
          const readme = await getRepoReadme(username, repo.name);
          const images = readme.match(/!\[[^\]]*\]\((https?:\/\/[^\s]+)\)/g);
          return { ...repo, readme, images };
        } catch (error) {
          console.error(`Error fetching data for repo ${repo.name}:`, error);
          return null;
        }
      })
    );

    const enhancedUserPRs = await Promise.all(
      userPRs.data.items.map(async (pr) => {
        try {
          console.log(`Processing PR #${pr.number}`);
          const mediaUrls = extractMediaUrl(pr.body);
          const images = mediaUrls.map((url) => ({
            url,
            preview_url: url,
            description: `Image from PR #${pr.number}`,
          }));

          const repoUrl = pr.repository_url;
          let repoInfo = { name: null, full_name: null, repo: null };
          if (repoUrl) {
            const repoMatch = repoUrl.match(/repos\/([^/]+\/[^/]+)$/);
            if (repoMatch) {
              const [_, full_name] = repoMatch;
              repoInfo = {
                name: full_name.split("/")[1],
                full_name,
                repo: await fetchGithubRepoInfo(full_name),
              };
            }
          }

          const { data: files } = await octokit.pulls.listFiles({
            owner: repoInfo.full_name.split("/")[0],
            repo: repoInfo.full_name.split("/")[1],
            pull_number: pr.number,
          });

          const changedFiles = files.map((file) => file.filename).join(", ");

          return {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            body: pr.body,
            changedFiles,
            html_url: pr.html_url,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            state: pr.state,
            repo: repoInfo,
            images: images,
            user: {
              login: pr.user.login,
              avatar_url: pr.user.avatar_url,
            },
          };
        } catch (error) {
          console.error(`Error processing PR ${pr.number}:`, error);
          return null;
        }
      })
    );

    const enhancedUserGists = await Promise.all(
      userGists.data.map(async (gist) => {
        try {
          const { data: gistData } = await octokit.gists.get({
            gist_id: gist.id,
          });
          const files = Object.values(gistData.files);
          let content = "";
          if (files.length === 1) {
            const file = files[0];
            const fileData = await octokit.gists.get({
              gist_id: gist.id,
              file: file.filename,
            });
            content = fileData.data.files[file.filename].content;
          }
          return {
            ...gist,
            content,
            files: files.map((file) => file.filename).join(", "),
          };
        } catch (error) {
          console.error(`Error fetching data for gist ${gist.id}:`, error);
          return null;
        }
      })
    );

    return {
      starredRepos: starredRepos.data,
      userRepos: enhancedUserRepos.filter(Boolean),
      userIssues: userIssues.data.items,
      userGists: enhancedUserGists.filter(Boolean),
      userReleases: userReleases.data.items,
      userPRs: enhancedUserPRs.filter(Boolean),
    };
  } catch (error) {
    console.error("Error fetching GitHub data:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    return {
      starredRepos: [],
      userRepos: [],
      userIssues: [],
      userGists: [],
      userReleases: [],
      userPRs: [],
    };
  }
};

const fetchGithubRepoInfo = (repoFullName) => {
  return octokit.repos
    .get({
      owner: repoFullName.split("/")[0],
      repo: repoFullName.split("/")[1],
    })
    .then((response) => response.data)
    .catch((error) => {
      console.error("Error fetching repo info:", error.message);
      return null;
    });
};

export async function getRepoReadme(owner, repo) {
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error) {
    console.error("Error fetching repo README:", error.message);
    return null;
  }
}

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
    });
}
