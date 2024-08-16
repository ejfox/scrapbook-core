import axios from "axios";
import Bottleneck from "bottleneck";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const limiter = new Bottleneck({
  maxConcurrent: 1,
});

function chooseLLMService() {
  // return process.env.USE_OPENAI === "true" ? "openai" : "local";
  return "local";
}

export async function summarizeGitHubActivity(activity, options = {}) {
  const content = formatGitHubActivityForSummary(activity);
  console.log("Content:", content);
  if (!content) {
    return "No content to summarize.";
  }

  try {
    const summary = await limiter.schedule(() =>
      summarizeGitHubString(content)
    );
    console.log("Summary:", summary);

    if (options.metaSummary) {
      console.log("Generating meta summary...");
      const metaSummary = await summarizeGitHubString(summary);
      return metaSummary;
    }

    return summary;
  } catch (error) {
    console.error("Error in summarizeGitHubActivity:", error);
    return "Error generating summary.";
  }
}

function formatGitHubActivityForSummary(activity) {
  let formattedContent = "";
  // add the type
  formattedContent += `Type: ${activity.type}\n`;

  // add the author
  formattedContent += `Author: ${activity.user?.login || ""}\n`;

  // add the href
  formattedContent += `URL: ${activity.href || ""}\n`;

  if (activity.type === "repository") {
    formattedContent = `Repository: ${activity.name}\n`;
    formattedContent += `Description: ${
      activity.description || "No description"
    }\n`;

    // add the readme of the repo the PR is to
    formattedContent += `Repository README: ${
      activity.repo?.readme || "No README"
    }\n`;

    formattedContent += `Language: ${activity.language || "Not specified"}\n`;
    formattedContent += `Stars: ${activity.stargazers_count || 0}\n`;
    formattedContent += `Forks: ${activity.forks_count || 0}\n`;
    formattedContent += `Last Updated: ${activity.updated_at || "Unknown"}\n`;
    formattedContent += `README: ${activity.readme || ""}\n`;
  } else if (activity.type === "gist") {
    formattedContent = `Gist: ${activity.name}\n`;
    formattedContent += `Files: ${activity.files || 0}\n`;
    formattedContent += `Content: ${activity.content || ""}\n`;
  } else if (activity.type === "pull_request") {
    formattedContent = `Pull Request: ${activity.title}\n`;
    // author
    formattedContent += `Author: ${activity.user?.login || "Unknown Author"}\n`;

    // add the pr body
    formattedContent += `PR Description: ${
      activity.body || "No description"
    }\n`;

    // add the list of changed files
    if (activity.changed_files) {
      formattedContent += `Changed Files: ${activity.changed_files}\n`;
    }

    formattedContent += `Repository: ${
      activity.repo?.full_name || "Unknown"
    }\n`;
    formattedContent += `Status: ${activity.state || "Unknown"}\n`;
    formattedContent += `Created: ${activity.created_at || "Unknown"}\n`;
    formattedContent += `Description: ${activity.body || "No description"}\n`;
  } else if (activity.type === "issue") {
    formattedContent = `Issue: ${activity.title}\n`;
    formattedContent += `Repository: ${
      activity.repo?.full_name || "Unknown"
    }\n`;
    formattedContent += `Status: ${activity.state || "Unknown"}\n`;
    formattedContent += `Created: ${activity.created_at || "Unknown"}\n`;
    formattedContent += `Description: ${activity.body || "No description"}\n`;
  } else {
    formattedContent = `Unhandled GitHub activity type: ${activity.type}\n`;
    formattedContent += `Raw data: ${JSON.stringify(activity, null, 2)}\n`;
  }

  return formattedContent;
}

async function summarizeGitHubString(content) {
  const messages = [
    {
      role: "system",
      content: `You are an expert at summarizing GitHub activities. Your goal is to distill the content into a concise, standalone sentence. Pay special attention to precise details, especially if they involve code, repository names, or issue/PR numbers. Include relevant URLs or specific references that are associated with these activities. Strive for clarity and brevity, ensuring that the most crucial information is presented first.`,
    },
    {
      role: "user",
      content: `${content}\nCan you summarize this GitHub activity please? Be sure to mention the author, the intention of the code, and any unique or interesting details. Keep it concise and informative. DO NOT include any other text, parantheticals, or introduction. Respond ONLY with the summary.`,
    },
  ];

  const llmService = chooseLLMService();

  try {
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      });
      return response.choices[0].message.content;
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.7,
        max_tokens: -1,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      return response.data.choices[0].message.content;
    }
  } catch (error) {
    console.error("Error in summarizeGitHubString:", error);
    return `Error: ${error.message}`;
  }
}

export async function gitHubSummaryToTags(summaryContent) {
  const messages = [
    {
      role: "system",
      content: `You are an expert at applying the correct tags to GitHub activity summaries. Please provide one tag per line. Respond with ONLY the tags, no other chatter, introduction, or conclusion.`,
    },
    {
      role: "user",
      content: `Perfect! Now let's apply tags most relevant to this GitHub activity summary. Apply the tags very sparingly, usually only 2-8 tags per action. Choose the most relevant tags. These tags should be specific to GitHub activities, such as 'repository', 'pull-request', 'style', 'refactor', 'chore', 'build', 'deploy', 'enhancement', 'feature', 'issue', 'commit', 'fork', 'star', etc. You can also include programming languages or technologies mentioned. What tags best apply to this summary?
${summaryContent}`,
    },
  ];

  const llmService = chooseLLMService();

  try {
    if (llmService === "openai") {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.2,
        max_tokens: 32,
      });
      return response.choices[0].message.content
        .split("\n")
        .filter((tag) => tag.trim() !== "");
    } else {
      const payload = {
        model: "Meta-Llama-3-8B-Instruct-imatrix",
        messages,
        temperature: 0.2,
        max_tokens: 32,
        stream: false,
      };
      const response = await axios.post(
        "http://localhost:1234/v1/chat/completions",
        payload
      );
      return response.data.choices[0].message.content
        .split("\n")
        .filter((tag) => tag.trim() !== "");
    }
  } catch (error) {
    console.error("Error in gitHubSummaryToTags:", error);
    return [];
  }
}
