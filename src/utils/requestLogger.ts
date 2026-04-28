/*
 * Code Map: Request Logger Utility
 * - createRequestLogger: Factory to create middleware that logs HTTP requests/responses
 * - RequestLog: Interface for stored request/response data
 *
 * CID Index:
 * CID:reqlog-001 -> createRequestLogger
 * CID:reqlog-002 -> RequestLog
 *
 * Quick lookup: rg -n "CID:reqlog-" src/utils/requestLogger.ts
 */

import fs from "fs";
import path from "path";
import { Request, Response, NextFunction } from "express";

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
const REQUEST_LOG_FILE = path.join(LOG_DIR, "requests.jsonl");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  query: Record<string, any>;
  body: Record<string, any>;
  headers: Record<string, any>;
  response?: {
    statusCode: number;
    body: Record<string, any>;
    duration_ms: number;
  };
  error?: string;
}

// CID:reqlog-001 - createRequestLogger
// Purpose: Factory to create Express middleware that logs all requests/responses
// Uses: fs.appendFileSync, Date, Request, Response, NextFunction
// Used by: src/index.ts middleware chain
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Capture original send method
    const originalSend = res.send;

    // Override send to capture response
    res.send = function (data: any) {
      const duration = Date.now() - startTime;

      // Parse response body
      let responseBody: Record<string, any> = {};
      try {
        responseBody = typeof data === "string" ? JSON.parse(data) : data;
      } catch {
        responseBody = { raw: data };
      }

      // Build log entry
      const log: RequestLog = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: req.query as Record<string, any>,
        body: req.body as Record<string, any>,
        headers: {
          "content-type": req.get("content-type"),
          "user-agent": req.get("user-agent")
        },
        response: {
          statusCode: res.statusCode,
          body: responseBody,
          duration_ms: duration
        }
      };

      // Append to JSONL file (one JSON object per line)
      fs.appendFileSync(
        REQUEST_LOG_FILE,
        JSON.stringify(log, null, 2) + "\n\n"
      );

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}

// CID:reqlog-002 - RequestLog
// Purpose: Type definition for captured request/response log entries
// Uses: TypeScript interfaces
// Used by: createRequestLogger return type

export function getRequestLogPath(): string {
  return REQUEST_LOG_FILE;
}
