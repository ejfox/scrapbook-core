import axios from "axios";
import Bottleneck from "bottleneck";

// const relationshipRegex =
//   /^\[([a-zA-Z0-9\s]+):([a-zA-Z0-9\s]+)\] -\[:([a-zA-Z0-9\s]+)\]-> \[([a-zA-Z0-9\s]+):([a-zA-Z0-9\s]+)\]$/;

const relationshipRegex =
  /^\[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\] -\[:([a-zA-Z0-9\s]+)\]-> \[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\]$/;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  // minTime: 1000,
});
function contentToChunks(content) {
  const chunkMaxChars = 2048;
  const chunks = [];

  // Split the content into paragraphs
  const paragraphs = content.split("\n");

  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= chunkMaxChars) {
      // If adding the current paragraph to the current chunk doesn't exceed the max chars,
      // append the paragraph to the current chunk
      currentChunk += paragraph + "\n";
    } else {
      if (currentChunk !== "") {
        // If the current chunk is not empty, push it to the chunks array
        chunks.push(currentChunk.trim());
      }

      if (paragraph.length <= chunkMaxChars) {
        // If the current paragraph fits within the max chars, start a new chunk with it
        currentChunk = paragraph + "\n";
      } else {
        // If the current paragraph exceeds the max chars, split it into smaller chunks
        const words = paragraph.split(" ");
        let currentSubChunk = "";

        for (const word of words) {
          if (currentSubChunk.length + word.length <= chunkMaxChars) {
            // If adding the current word to the current sub-chunk doesn't exceed the max chars,
            // append the word to the current sub-chunk
            currentSubChunk += word + " ";
          } else {
            // If adding the current word exceeds the max chars, push the current sub-chunk
            // to the chunks array and start a new sub-chunk with the current word
            chunks.push(currentSubChunk.trim());
            currentSubChunk = word + " ";
          }
        }

        // Push the last sub-chunk to the chunks array
        if (currentSubChunk !== "") {
          chunks.push(currentSubChunk.trim());
        }

        currentChunk = "";
      }
    }
  }

  // Push the last chunk to the chunks array
  if (currentChunk !== "") {
    chunks.push(currentChunk.trim());
  }

  console.log(`Chunks: ${chunks.length}`);

  return chunks;
}

export async function summarizeContent(content, options = {}) {
  console.log("Breaking content into chunks...");
  const chunks = contentToChunks(content);

  console.log("Summarizing each chunk...");
  const summaries = await Promise.all(
    chunks.map(async (chunk) => {
      return await limiter.schedule(async () => {
        return await summarizeString(chunk);
      });
    })
  );

  console.log("Concatenating summaries...");
  const summary = summaries.join(" ");

  console.log("Splitting relationships into an array...");
  const relationships = summary
    .split("\n")
    .filter((line) => line.trim() !== "");
  console.log(`Relationships: ${relationships.length}`);

  console.log("Parsing relationships and creating nodes and relationships...");
  const nodes = new Set();
  const relationshipsData = [];

  for (const relationship of relationships) {
    const match = relationship.match(relationshipRegex);
    if (match) {
      const [
        _,
        sourceType,
        sourceName,
        relationshipType,
        targetType,
        targetName,
      ] = match;
      const sourceNode = { type: sourceType.trim(), name: sourceName.trim() };
      const targetNode = { type: targetType.trim(), name: targetName.trim() };

      nodes.add(JSON.stringify(sourceNode));
      nodes.add(JSON.stringify(targetNode));

      relationshipsData.push({
        source: sourceNode,
        target: targetNode,
        type: relationshipType.trim(),
      });
    } else {
      console.log(`Invalid relationship format: ${relationship}`);
    }
  }

  console.log("De-duplicating nodes...");
  const uniqueNodes = Array.from(nodes).map((nodeString) =>
    JSON.parse(nodeString)
  );
  console.log(`Unique nodes: ${uniqueNodes.length}`);

  console.log("Returning summary, nodes, and relationships...");
  console.log(`Summary: ${summary.length} characters`);
  console.log(`Nodes: ${uniqueNodes.length}`);
  console.log(`Relationships: ${relationshipsData.length}`);
  return {
    summary,
    nodes: uniqueNodes,
    relationships: relationshipsData,
  };
}
export async function summarizeString(content) {
  console.log("Creating messages array...");
  const messages = [];
  if (!content) {
    return "No content provided.";
  }

  console.log("Adding system prompt to messages...");
  messages.push({
    role: "system",
    content: `Extract entities and relationships from the given document to generate relationship strings that will inform further research and investigations. Record any pertinent information that can be used to establish connections between entities. Connections between technologies, influential people, political organizations, police departments, and other entities can be particularly useful. Remember that the goal is to create a knowledge graph that can be queried to uncover hidden connections and relationships.
    `,
  });

  messages.push({
    role: "user",
    content: `Use ONLY these entity types:
Person, Organization, Event, Product, Technology, Startup, Research Group, Investor, Conference, Publication, Government Agency, Non-Profit Organization, Educational Institution, Concept, Framework, Industry Group, Influencer, Platform, Standard/Protocol, Funding Round

And ONLY these relationship types:  
Founded, Invested In, Collaborated With, Spoke At, Developed, Researched By, Participated In, Published By, Supported By, Affiliated With, Implemented By, Member Of, Promoted By, Standardized By, Held At, Funded By, Reviewed By, Influenced By, Sponsored By

They need to match this regex: /^\[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\] -\[:([a-zA-Z0-9\s]+)\]-> \[([a-zA-Z0-9\s]+):\s*([a-zA-Z0-9\s]+)\]$/

Output each relationship on a new line using this EXACT format:
[entity1_type:entity1_name] -[:RELATIONSHIP_TYPE]-> [entity2_type:entity2_name]

Examples:
[person:Stewart Brand] -[:FOUNDED]-> [organization:Whole Earth Catalog]
[person:Steve Jobs] -[:INFLUENCED_BY]-> [person:Stewart Brand]
[organization:Apple] -[:DEVELOPED]-> [technology:iPhone]    
    `,
  });

  console.log("Adding user content to messages...");
  messages.push({
    role: "user",
    content: `${content}
    
Please provide one relationship per line. Return ONLY the relationships, no other text. Do not include any other information in your response besides the newline-delimited relationships.
    `,
  });

  console.log("Creating payload...");
  const payload = {
    model: "Meta-Llama-3-8B-Instruct-imatrix",
    messages,
    temperature: 0.7,
    max_tokens: -1,
    stream: false,
  };

  console.log("Sending messages to local llama...");
  const response = await axios.post(
    "http://localhost:1234/v1/chat/completions",
    payload
  );

  const responseMsg = response.data.choices[0].message.content;

  // make sure the responseMsg contains at least one relationship, otherwise retry summarization
  if (!responseMsg.match(relationshipRegex)) {
    console.log(
      "Response message does not contain any relationships, retrying summarization... \n" +
        responseMsg
    );
    return await summarizeString(content, { metaSummary: true });
  }

  console.log(
    `Returning response... ${responseMsg.length} characters \n ${responseMsg}`
  );
  return responseMsg;
}

export async function testSummarization() {
  const content = `In the back of Hiro's trailer, amidst the flickering glow of the virtual cityscape, was his digital command center - the Memorybook dashboard. It was a sight to behold, a modern rendition of a detective's corkboard, but far more dynamic and immersive.

  The dashboard pulsed with life, displaying a kaleidoscope of threads and uncategorized scraps, each one a potential clue in Hiro's quest for knowledge. The threads, like strands of virtual red yarn, crisscrossed the screen, connecting ideas and concepts in a mesmerizing dance of information.
  
  Hiro navigated the dashboard with the skill of a seasoned detective, using a combination of gestures and voice commands to sift through the digital sea of data. As he interacted with the dashboard, it responded in kind, adapting to his movements and providing him with new insights and connections.
  
  But the dashboard was more than just a tool for organizing information - it was a window into Hiro's mind, a reflection of his thoughts and ideas. It was a place where he could explore new concepts, make unexpected connections, and uncover hidden truths.
  
  As Hiro delved deeper into the dashboard, he felt a sense of exhilaration, a thrill of discovery. He was no longer just a passive observer - he was an active participant in the world of ideas, shaping and molding his digital landscape with each interaction.
  
  And as the dashboard rotated through threads and uncategorized scraps, Hiro knew that he was on the cusp of a breakthrough. With each new connection he made, he moved one step closer to unraveling the mysteries of the Metaverse and unlocking the true potential of his own mind.
  
  In Hiro's digital domain, every screenshot he took was more than just a picture - it was a potential clue, a piece of the puzzle in his quest for knowledge. The Memorybook system automatically analyzed each screenshot, extracting key information and integrating it seamlessly into the dashboard.
  
  As Hiro captured a screenshot, the system sprang into action, scanning the image for recognizable patterns and text. Using advanced image recognition algorithms, it identified key elements such as text, objects, and colors, and translated them into digital data.
  
  This data was then fed into the Memorybook dashboard, where it appeared as a new scrap - a visual representation of the screenshot, augmented with tags and metadata extracted from the image. Hiro could then categorize the scrap, connect it to existing threads, or use it as a starting point for further exploration.
  
  But the system didn't stop there. It also analyzed the content of the screenshot itself, looking for patterns and connections with other scraps in the dashboard. For example, if Hiro took a screenshot of a news article about climate change, the system might suggest connecting it to existing threads about environmental activism or scientific research.
  
  In this way, every screenshot Hiro took became a valuable piece of information, adding depth and context to his digital detective work. And as he continued to capture and analyze screenshots, the Memorybook system grew smarter, constantly refining its understanding of Hiro's interests and helping him uncover new insights and connections in the vast sea of data.`;
  console.log("Starting test summarization...");
  const summary = await summarizeContent(content, { metaSummary: true });
  console.log("Test summarization completed. Result:");
  console.log(JSON.stringify(summary, null, 2));
}

testSummarization();
