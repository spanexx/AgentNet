/*
 * Code Map: AgentNet Application Entry Point
 * - bootstrap: Bootstraps database connection and starts server
 *
 * CID Index:
 * CID:index-001 -> bootstrap
 *
 * Quick lookup: rg -n "CID:index-" src/index.ts
 */

import { config } from "dotenv";
import { getEmbeddingRuntimeStatus } from "./core/embedding-runtime";
import { connectDB } from "./core/db";
import { loadSeedData } from "./core/seed-loader";
import { createServer, startServer } from "./server";

config({ path: ".env.local" });
config();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// CID:index-001 - bootstrap
// Purpose: Entry point for application startup: DB connection → server start
// Uses: connectDB, createServer, startServer, PORT
// Used by: npm run dev, npm start
async function bootstrap() {
  try {
    // Establish database connection
    await connectDB();

    // Load YAML seed catalogs (intents + tags) into MongoDB
    await loadSeedData();

    const embeddingStatus = await getEmbeddingRuntimeStatus();
    console.log(`[embeddings] mode=${embeddingStatus.mode}`);
    console.log(
      `[embeddings] configured=${embeddingStatus.configuredProviders.join(",") || "none"}`
    );
    console.log(
      `[embeddings] available=${embeddingStatus.availableProviders.join(",") || "none"}`
    );

    // Create and start HTTP server
    const app = createServer();
    await startServer(app, PORT);
  } catch (err) {
    console.error("✗ Failed to start application:", err);
    process.exit(1);
  }
}

bootstrap();
