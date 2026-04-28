/*
 * Code Map: MongoDB Connection Manager
 * - connectDB: Establishes connection to MongoDB and initializes Mongoose
 * - ConnectionConfig: Encapsulates connection parameters
 *
 * CID Index:
 * CID:db-001 -> connectDB
 * CID:db-002 -> getConnectionStatus
 *
 * Quick lookup: rg -n "CID:db-" src/core/db.ts
 */

import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agentnet";

// CID:db-001 - connectDB
// Purpose: Initialize MongoDB connection and handle lifecycle
// Uses: mongoose.connect, process.exit
// Used by: src/index.ts on app startup
export async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ MongoDB connected");
    return true;
  } catch (err) {
    console.error("✗ DB connection failed:", err);
    process.exit(1);
  }
}

// CID:db-002 - getConnectionStatus
// Purpose: Query current Mongoose connection state
// Uses: mongoose.connection.readyState
// Used by: health checks, diagnostics
export function getConnectionStatus() {
  return {
    connected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    uri: MONGO_URI
  };
}

// Connection event listeners for debugging
mongoose.connection.on("connected", () =>
  console.log("Mongoose connected to MongoDB")
);
mongoose.connection.on("error", (err) => console.error("Mongoose error:", err));
mongoose.connection.on("disconnected", () =>
  console.log("Mongoose disconnected")
);
