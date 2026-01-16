#!/usr/bin/env tsx
/**
 * Migration script to add normalized title fields to existing publications
 * 
 * This script updates all existing publications in the database with the new 
 * normalizedTitle and normalizedTitleWords fields. These fields are used to 
 * optimize text search performance in the textAlert feature.
 * 
 * Run with: npm run migrate-publications or tsx scripts/migratePublications.ts
 * 
 * The script:
 * - Finds all publications without normalized fields
 * - Computes normalized title and word arrays for each publication
 * - Updates publications in batches of 1000 to avoid memory issues
 * - Is safe to run multiple times (idempotent)
 */

import "dotenv/config";
import { mongodbConnect, mongodbDisconnect } from "../db.ts";
import { Publication } from "../models/Publication.ts";
import { normalizeFrenchText } from "../utils/text.utils.ts";

async function migratePublications(): Promise<void> {
  console.log("Starting publication migration...");
  
  await mongodbConnect();
  
  // Find all publications that don't have normalized fields
  const publicationsToMigrate = await Publication.find({
    $or: [
      { normalizedTitle: { $exists: false } },
      { normalizedTitleWords: { $exists: false } }
    ]
  }).lean();
  
  console.log(`Found ${publicationsToMigrate.length} publications to migrate`);
  
  if (publicationsToMigrate.length === 0) {
    console.log("No publications to migrate. Exiting...");
    await mongodbDisconnect();
    return;
  }
  
  // Process in batches to avoid memory issues
  const BATCH_SIZE = 1000;
  let processed = 0;
  
  for (let i = 0; i < publicationsToMigrate.length; i += BATCH_SIZE) {
    const batch = publicationsToMigrate.slice(i, i + BATCH_SIZE);
    
    const bulkOps = batch.map((pub) => {
      const normalizedTitle = normalizeFrenchText(pub.title);
      return {
        updateOne: {
          filter: { id: pub.id },
          update: {
            $set: {
              normalizedTitle,
              normalizedTitleWords: normalizedTitle.split(" ").filter(Boolean)
            }
          }
        }
      };
    });
    
    await Publication.bulkWrite(bulkOps, { ordered: false });
    processed += batch.length;
    
    console.log(`Processed ${processed} / ${publicationsToMigrate.length} publications`);
  }
  
  console.log("Migration completed successfully!");
  await mongodbDisconnect();
}

migratePublications().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
