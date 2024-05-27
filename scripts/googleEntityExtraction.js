export async function analyzeEntities(content) {
  // content is the raw text of a webpage
  // we need to pass it to the Google Entity Extraction API

  // Imports the Google Cloud client library
  const language = require("@google-cloud/language").v2;

  // Creates a client
  const client = new language.LanguageServiceClient();

  /**
   * TODO(developer): Uncomment the following line to run this code.
   */
  // const text = 'Your text to analyze, e.g. Hello, world!';

  // Prepares a document, representing the provided text
  const document = {
    // content: text,
    content,
    type: "PLAIN_TEXT",
  };

  // Detects entities in the document
  const [result] = await client.analyzeEntities({ document });

  const entities = result.entities;

  console.log("Entities:");
  entities.forEach((entity) => {
    console.log(entity.name);
    console.log(` - Type: ${entity.type}`);
    if (entity.metadata) {
      console.log(` - Metadata: ${entity.metadata}`);
    }
  });
}
