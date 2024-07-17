import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import os from "os";
import { formatDistanceToNow, parseISO } from "date-fns";

async function search(query) {
  const dbPath = path.join(os.homedir(), "scraps.db");
  console.error(`Searching database at: ${dbPath}`);

  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    const sanitizedQuery = query.replace(/[^\w\s]/gi, "");
    console.error(`Searching for: ${sanitizedQuery}`);

    const results = await db.all(
      `
      SELECT DISTINCT *
      FROM scraps
      WHERE scraps MATCH ?
      ORDER BY created_at DESC
      LIMIT 20
    `,
      sanitizedQuery
    );

    console.error(`Found ${results.length} results`);

    if (results.length === 0) {
      return [
        {
          title: "No results found",
          subtitle: "Try a different search query",
          valid: false,
        },
      ];
    }

    return results.map((result) => {
      let metadata;
      try {
        metadata =
          typeof result.metadata === "string"
            ? JSON.parse(result.metadata)
            : result.metadata;
      } catch (e) {
        console.error(
          `Error parsing metadata for scrap ${result.scrap_id}: ${e.message}`
        );
        metadata = {};
      }

      const url = metadata.href || "";
      const domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
      const title = truncate(result.content || "No title", 50);
      const subtitle = formatSubtitle(result, metadata, domain);
      // const icon = metadata.icon || metadata.screenshotUrl || "";

      console.error(
        `Processing result: ${JSON.stringify({
          title,
          subtitle: subtitle.substring(0, 50) + "...",
          url,
        })}`
      );

      return {
        title: title,
        subtitle: subtitle,
        arg: url, // This is the key change
        text: {
          copy: result.content || "",
          largetype: result.content || "",
        },
        quicklookurl: url,
        // icon: { path: icon },
        mods: {
          alt: {
            subtitle: "Press ⌥ to view full content",
            arg: result.content || "",
            valid: true,
          },
          cmd: {
            subtitle: "Press ⌘ to copy content",
            // arg: result.content || "",
            // lets actually make this a nicely formatted plaintext version of the scrap
            args: formatScrapForCopy(result, metadata),
            valid: true,
          },
        },
      };
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return [
      {
        title: "An error occurred",
        subtitle: error.message,
        valid: false,
      },
    ];
  }
}

function formatScrapForCopy(result, metadata) {
  const url = metadata?.href || "";
  const domain = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  // const title = result?.content || "No title";
  const title = truncate(
    result.title || metadata.title || result.content || "No title",
    100
  );
  const subtitle = formatSubtitle(result, metadata, domain);
  // const tags = result?.tags?.join(", ") || "No tags";
  const created = result?.created_at || "Unknown";
  const updated = result?.updated_at || "Unknown";
  const metadataString = JSON.stringify(metadata, null, 2);

  const formattedScrap = [];
  formattedScrap.push(`Title: ${title}`);
  formattedScrap.push(`URL: ${url}`);
  formattedScrap.push(`Domain: ${domain}`);
  formattedScrap.push(`Summary: ${subtitle}`);
  // formattedScrap.push(`Tags: ${tags}`);
  formattedScrap.push(`Created: ${created}`);
  formattedScrap.push(`Updated: ${updated}`);
  formattedScrap.push(`Metadata: ${metadataString}`);

  return formattedScrap.join("\n");
}

function truncate(str, length) {
  return str.length > length ? str.substring(0, length) + "..." : str;
}

function formatSubtitle(result, metadata, domain) {
  const summary = truncate(
    result.summary || result.content || "No content available",
    80
  );
  const age = formatDistanceToNow(parseISO(result.created_at), {
    addSuffix: true,
  });
  return `${domain ? domain + " | " : ""}${summary} (${age})`;
}

const query = process.argv[2];

if (!query) {
  console.log(
    JSON.stringify({
      items: [
        {
          title: "Enter a search query",
          subtitle: "Type something to search for scraps",
          valid: false,
        },
      ],
    })
  );
} else {
  search(query)
    .then((results) => {
      console.log(JSON.stringify({ items: results }));
    })
    .catch((error) => {
      console.log(
        JSON.stringify({
          items: [
            {
              title: "An error occurred",
              subtitle: error.message,
              valid: false,
            },
          ],
        })
      );
    });
}
