import { createClient } from "@supabase/supabase-js";
import * as helpers from "../helpers.js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
);

async function migrateIds() {
  console.log("Starting ID migration...");

  const { data: scraps, error } = await supabase
    .from("scraps")
    .select("*");

  if (error) {
    console.error("Failed to fetch scraps:", error);
    return;
  }

  for (const scrap of scraps) {
    // Generate new UUID if needed
    if (!scrap.id) {
      scrap.id = helpers.generateScrapId(scrap.source, scrap.scrap_id);
    }

    // Ensure metadata exists and contains shortId
    scrap.metadata = {
      ...scrap.metadata,
      shortId: helpers.generateShortId(scrap.id),
    };

    const { error: updateError } = await supabase
      .from("scraps")
      .update({
        id: scrap.id,
        metadata: scrap.metadata,
      })
      .eq("scrap_id", scrap.scrap_id);

    if (updateError) {
      console.error(`Failed to update scrap ${scrap.scrap_id}:`, updateError);
    }
  }

  console.log("Migration complete");
}

migrateIds().catch(console.error);
