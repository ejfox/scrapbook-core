import * as fs from "fs";
import path from "path";
import axios from "axios";
import ora from "ora";
import dotenv from "dotenv";

dotenv.config();

const username = "ejfox";
const token = process.env.GITHUB_TOKEN;

const fetchGithubData = async () => {
  const spinner = ora("Initializing GitHub data download...").start();

  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
  };

  try {
    const [
      starredRepos,
      userRepos,
      userIssues,
      userGists,
      userReleases,
      userPRs,
    ] = await Promise.all([
      axios.get(`https://api.github.com/users/${username}/starred`, {
        headers,
      }),
      axios.get(`https://api.github.com/users/${username}/repos`, { headers }),
      axios.get(
        `https://api.github.com/search/issues?q=author:${username}+is:public`,
        { headers }
      ),
      axios.get(`https://api.github.com/users/${username}/gists`, { headers }),
      axios.get(
        `https://api.github.com/search/issues?q=author:${username}+is:public+type:release`,
        { headers }
      ),
      axios.get(
        `https://api.github.com/search/issues?q=author:${username}+is:public+type:pr`,
        { headers }
      ),
    ]);

    spinner.succeed("Downloaded GitHub data");

    return {
      starredRepos: starredRepos.data,
      userRepos: userRepos.data.filter((repo) => repo.visibility === "public"),
      userIssues: userIssues.data.items,
      userGists: userGists.data,
      userReleases: userReleases.data.items,
      userPRs: userPRs.data.items,
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

export { fetchGithubData, saveGithubData };
