import axios from "axios";
import Bottleneck from "bottleneck";

const limiter = new Bottleneck({
  maxConcurrent: 1,
  // minTime: 1000,
});

// this breaks the large content into smaller chunks
// and concatenates the results
// and generates a final meta-summary, optionally
export async function summarizeContent(content, options = {}) {
  // first we break the content into chunks by newlines
  const chunks = content.split("\n");

  // then we make sure none of the chunks is larger than 1024 characters (roughly)
  const chunkSizeChars = 1024;

  // then we break the chunks into smaller chunks
  const smallerChunks = chunks.map((chunk) => {
    const smallerChunk = chunk.match(new RegExp(`.{1,${chunkSizeChars}}`, "g"));
    return smallerChunk;
  });

  // then we flatten the smaller chunks so we have a flat array of chunks
  const flatChunks = smallerChunks.flat();

  // then we summarize each chunk

  // then we summarize each chunk
  const summaries = await Promise.all(
    flatChunks.map(async (chunk) => {
      await limiter.schedule(async () => {
        return await summarizeString(chunk);
      });
    })
  );

  // then we concatenate the summaries
  const summary = summaries.join(" ");

  // then we generate a meta-summary
  if (options.metaSummary) {
    const metaSummary = await summarizeString(summary);
    return metaSummary;
  }

  return summary;
}

// this summarizes individual chunks of text into facts
export async function summarizeString(content) {
  // first we create our messages array out of the content
  const messages = [];

  // system prompt
  messages.push({
    role: "system",
    content: `You need to summarize this content into facts. Please provide one fact per line. Return ONLY the facts, no other text.`,
  });

  // content input via user request
  messages.push({
    role: "user",
    content: content,
  });

  // make a payload like OpenAI expects
  /*
  curl http://localhost:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{ 
    "model": "model-identifier",
    "messages": [ 
      { "role": "system", "content": "Always answer in rhymes." },
      { "role": "user", "content": "Introduce yourself." }
    ], 
    "temperature": 0.7, 
    "max_tokens": -1,
    "stream": true
}'

model info:
{
  "name": "Meta-Llama-3-8B-Instruct-imatrix",
  "arch": "llama",
  "quant": "Q4_K_M",
  "context_length": 8192,
  "embedding_length": 4096,
  "num_layers": 32,
  "rope": {
    "freq_base": 500000,
    "dimension_count": 128
  },
  "head_count": 32,
  "head_count_kv": 8,
  "parameters": "7B"
}
*/
  const payload = {
    // model: "model-identifier",
    model: "Meta-Llama-3-8B-Instruct-imatrix",
    messages,
    temperature: 0.7,
    max_tokens: -1,
    stream: false,
  };

  // send the messages to the local llama
  // const response = await axios.post(localLlamaUrl, { messages });
  const response = await axios.post(
    "http://localhost:1234/v1/chat/completions",
    payload
  );

  // return the response
  return response.data.choices[0].message;
}

// make a test function we can try out when we run this script
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
  const summary = await summarizeString(content);
  console.log(summary);
}

// testSummarization();
