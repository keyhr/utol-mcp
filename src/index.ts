#!/usr/bin/env node
import { config } from "dotenv";
import { join } from "node:path";
import { dataDir } from "./config.js";

config({ path: join(dataDir(), ".env") });

import { runCli } from "./cli.js";
import { logger } from "./logger.js";

runCli(process.argv).catch((err) => {
  logger.error("致命的なエラー", { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
