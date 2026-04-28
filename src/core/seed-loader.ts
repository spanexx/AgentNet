/*
 * Code Map: YAML Seed Loader (SDG)
 * - loadSeedData: Loads intents.yaml + tags.yaml into SemanticCluster collection on startup
 * - loadClusters: Upserts seed clusters from YAML into unified semantic space
 * - generateSeedCentroids: Generates centroid embeddings for clusters with empty vectors
 *
 * CID Index:
 * CID:seed-loader-001 -> loadSeedData
 * CID:seed-loader-002 -> loadClusters
 * CID:seed-loader-003 -> generateSeedCentroids
 *
 * Quick lookup: rg -n "CID:seed-loader-" src/core/seed-loader.ts
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { SemanticClusterModel } from "../models/SemanticCluster";
import { EmbeddingEnsemble } from "./embeddings/ensemble";

interface IntentSeed {
  name: string;
  aliases: string[];
}

interface TagSeed {
  name: string;
  synonyms: string[];
}

interface IntentsYaml {
  intents: IntentSeed[];
}

interface TagsYaml {
  tags: TagSeed[];
}

// CID:seed-loader-001 - loadSeedData
// Purpose: Load YAML seed catalogs into unified SemanticCluster collection, then generate centroids
// Uses: loadClusters, generateSeedCentroids
// Used by: src/index.ts on startup
export async function loadSeedData(): Promise<void> {
  const dataDir = path.resolve(__dirname, "../data");
  await loadClusters(dataDir);
  await generateSeedCentroids();
}

// CID:seed-loader-002 - loadClusters
// Purpose: Upsert intent + tag seeds from YAML into SemanticCluster collection
// Uses: SemanticClusterModel, js-yaml
// Used by: loadSeedData
async function loadClusters(dataDir: string): Promise<void> {
  let upserted = 0;

  // Load intent seeds
  const intentsPath = path.join(dataDir, "intents.yaml");
  if (fs.existsSync(intentsPath)) {
    const raw = fs.readFileSync(intentsPath, "utf-8");
    const parsed = yaml.load(raw) as IntentsYaml;

    if (parsed?.intents?.length) {
      for (const intent of parsed.intents) {
        await SemanticClusterModel.findOneAndUpdate(
          { label: intent.name, kind: "intent" },
          {
            $setOnInsert: {
              label: intent.name,
              kind: "intent",
              centroid: [],
              density: 0,
              exemplars: intent.aliases,
              source: "seed",
              frequency: 0,
            },
          },
          { upsert: true }
        );
        upserted++;
      }
    }
  } else {
    console.warn("[seed-loader] intents.yaml not found, skipping");
  }

  // Load tag seeds
  const tagsPath = path.join(dataDir, "tags.yaml");
  if (fs.existsSync(tagsPath)) {
    const raw = fs.readFileSync(tagsPath, "utf-8");
    const parsed = yaml.load(raw) as TagsYaml;

    if (parsed?.tags?.length) {
      for (const tag of parsed.tags) {
        await SemanticClusterModel.findOneAndUpdate(
          { label: tag.name, kind: "tag" },
          {
            $setOnInsert: {
              label: tag.name,
              kind: "tag",
              centroid: [],
              density: 0,
              exemplars: tag.synonyms,
              source: "seed",
              frequency: 0,
            },
          },
          { upsert: true }
        );
        upserted++;
      }
    }
  } else {
    console.warn("[seed-loader] tags.yaml not found, skipping");
  }

  console.log(`[seed-loader] ${upserted} clusters seeded`);
}

// CID:seed-loader-003 - generateSeedCentroids
// Purpose: Generate centroid embeddings for clusters with empty centroid vectors
// Uses: EmbeddingEnsemble, SemanticClusterModel
// Used by: loadSeedData
async function generateSeedCentroids(): Promise<void> {
  const ensemble = new EmbeddingEnsemble();
  let count = 0;

  const seeds = await SemanticClusterModel.find({ centroid: { $size: 0 }, source: "seed" });
  for (const seed of seeds) {
    try {
      const text = [seed.label, ...seed.exemplars.slice(0, 2)].join(" ");
      const result = await ensemble.embed(text);
      await SemanticClusterModel.updateOne(
        { _id: seed._id },
        { $set: { centroid: result.vector } }
      );
      count++;
    } catch (err) {
      console.warn(`[seed-loader] Failed to embed cluster "${seed.label}":`, err);
    }
  }

  if (count > 0) {
    console.log(`[seed-loader] Generated centroids for ${count} clusters`);
  } else {
    console.log("[seed-loader] All seed centroids already present");
  }
}
