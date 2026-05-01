/*
 * Code Map: Server Initialization & Lifecycle
 * - createServer: Factory to build configured Express application
 * - startServer: Start HTTP listener on configured port
 *
 * CID Index:
 * CID:server-001 -> createServer
 * CID:server-002 -> startServer
 *
 * Quick lookup: rg -n "CID:server-" src/server.ts
 */

import express, { Express } from "express";
import routes from "./api/routes";
import { getEmbeddingRuntimeStatus } from "./core/embedding-runtime";
import { getConnectionStatus } from "./core/db";
import { createRequestLogger } from "./utils/requestLogger";

// CID:server-001 - createServer
// Purpose: Factory function to instantiate and configure Express app
// Uses: express, routes, createRequestLogger
// Used by: startServer, tests
export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logger (captures to JSON file)
  app.use(createRequestLogger());

  // Request logging
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Routes
  app.use("/api", routes);

  // Health check endpoint
  app.get("/health", async (req, res) => {
    try {
      const [database, embeddings] = await Promise.all([
        Promise.resolve(getConnectionStatus()),
        getEmbeddingRuntimeStatus(),
      ]);

      res.json({
        status: database.connected ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        database,
        embeddings,
      });
    } catch (error) {
      console.error("[health] failed to build runtime status", error);
      res.status(500).json({
        status: "error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Home route
  app.get("/", (req, res) => {
    res.json({
      name: "AgentNet",
      version: "0.1.0",
      description: "Flexible protocol-based platform for AI agent intelligence sharing",
      status: "running",
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}

// CID:server-002 - startServer
// Purpose: Bind Express app to port and return running server instance
// Uses: Express.listen, PORT env var
// Used by: src/index.ts main()
export function startServer(
  app: Express,
  port: number
): Promise<{ port: number; app: Express }> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`✓ AgentNet running on http://localhost:${port}`);
      console.log(`  POST /api/message`);
      console.log(`  GET  /api/messages`);
      console.log(`  GET  /api/search`);
      console.log(`  GET  /api/semantic-search`);
      console.log(`  GET  /health`);
      resolve({ port, app });
    });

    // Graceful shutdown signal handler
    process.on("SIGINT", () => {
      console.log("\n✓ Shutting down gracefully...");
      server.close(() => {
        process.exit(0);
      });
    });
  });
}
