import { Octokit } from "@octokit/rest";
import ora from "ora";
import dotenv from "dotenv";
import * as fs from "fs";
import path from "path";
import { subDays } from "date-fns";

dotenv.config();

const username = "ejfox";
const token = process.env.GITHUB_TOKEN;
const FETCH_DAYS = 60;

const octokit = new Octokit({
  auth: token,
  userAgent: `${username}-scrapbook`,
  previews: ["mercy-preview"], // enable the `mercy` preview to access the check run API
});

const extractMediaUrl = (text) => {
  const urls = [];
  if (!text) return urls;

  // Decode URL-encoded text
  const decodedText = decodeURIComponent(text);

  console.log(`Extracting media URLs from text: ${decodedText}`);

  // Inline URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let match;
  while ((match = urlRegex.exec(decodedText))) {
    if (
      /\.(png|jpe?g|gif|mp4|webm)$/i.test(match[0]) ||
      /\/assets\//.test(match[0])
    ) {
      console.log(`Found inline media URL: ${match[0]}`);
      urls.push(match[0]);
    }
  }

  // Markdown image links
  const markdownImageRegex = /!\[[^\]]*\]\((https?:\/\/[^\s]+)\)/g;
  while ((match = markdownImageRegex.exec(decodedText))) {
    if (
      /\.(png|jpe?g|gif|mp4|webm)$/i.test(match[1]) ||
      /\/assets\//.test(match[1])
    ) {
      console.log(`Found markdown media URL: ${match[1]}`);
      urls.push(match[1]);
    }
  }

  // HTML image tags
  const htmlImageRegex = /<img [^>]*src="(https?:\/\/[^"]+)"/g;
  while ((match = htmlImageRegex.exec(decodedText))) {
    if (
      /\.(png|jpe?g|gif|mp4|webm)$/i.test(match[1]) ||
      /\/assets\//.test(match[1])
    ) {
      console.log(`Found HTML media URL: ${match[1]}`);
      urls.push(match[1]);
    }
  }

  return urls;
};

const fetchGithubData = async () => {
  const spinner = ora("Initializing GitHub data download...").start();

  const sinceDate = subDays(new Date(), FETCH_DAYS).toISOString();
  console.log(`Fetching data since: ${sinceDate}`);

  try {
    const [
      starredRepos,
      userRepos,
      userIssues,
      userGists,
      userReleases,
      userPRs,
    ] = await Promise.all([
      octokit.activity.listReposStarredByUser({
        username,
        per_page: 100,
        sort: "created",
        direction: "desc",
        since: sinceDate,
      }),
      octokit.repos.listForUser({
        username,
        type: "owner",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        since: sinceDate,
      }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public updated:>${sinceDate}`,
      }),
      octokit.gists.listForUser({ username }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public type:release updated:>${sinceDate}`,
      }),
      octokit.search.issuesAndPullRequests({
        q: `author:${username} is:public type:pr updated:>${sinceDate}`,
      }),
    ]);

    spinner.succeed("Downloaded GitHub data");

    const enhancedUserRepos = await Promise.all(
      userRepos.data.map(async (repo) => {
        try {
          await octokit.repos.get({
            owner: username,
            repo: repo.name,
          });

          const { data: readmeData } = await octokit.repos.getReadme({
            owner: username,
            repo: repo.name,
          });

          const readme = Buffer.from(readmeData.content, "base64").toString(
            "utf-8"
          );

          const { data: contents } = await octokit.repos.getContent({
            owner: username,
            repo: repo.name,
            path: "",
          });

          const imageFiles = contents
            .filter(
              (file) =>
                file.type === "file" && /\.(png|jpe?g|gif)$/i.test(file.name)
            )
            .map((file) => file.download_url);

          const images = imageFiles.map((url) => ({
            url,
            preview_url: url, // GitHub doesn't provide separate preview URLs
            description: `Image from ${repo.name} repository`,
          }));

          return {
            ...repo,
            readme,
            images,
          };
        } catch (error) {
          if (error.status === 404) {
            console.warn(
              `Repo ${repo.name} not found or has been moved/deleted.`
            );
            return null;
          }
          console.error(`Error fetching data for repo ${repo.name}:`, error);
          return null;
        }
      })
    );

    const validRepos = enhancedUserRepos.filter(Boolean);

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

          // Extract repo information safely
          let repoInfo = {
            name: null,
            full_name: null,
          };

          if (pr.base && pr.base.repo) {
            repoInfo = {
              name: pr.base.repo.name,
              full_name: pr.base.repo.full_name,
            };
          } else if (pr.head && pr.head.repo) {
            repoInfo = {
              name: pr.head.repo.name,
              full_name: pr.head.repo.full_name,
            };
          }

          return {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            body: pr.body,
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

    const validPRs = enhancedUserPRs.filter(Boolean);

    return {
      starredRepos: starredRepos.data,
      userRepos: validRepos,
      userIssues: userIssues.data.items,
      userGists: userGists.data,
      userReleases: userReleases.data.items,
      userPRs: validPRs,
    };
  } catch (error) {
    spinner.fail("Error downloading GitHub data");
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

const dirPath = path.join(process.cwd(), "public", "data", "scrapbook");
const filePath = path.join(dirPath, "github.json");

const saveGithubData = async (githubData) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(githubData, null, 2));
    console.log("GitHub data saved successfully");
  } catch (error) {
    console.error("Error saving GitHub data:", error);
  }
};

export { fetchGithubData, saveGithubData, fetchGithubRepoInfo };
