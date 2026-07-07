#!/usr/bin/env node
import { runCli } from "./cli.js";
import { logger } from "./logger.js";

runCli(process.argv).catch((err) => {
  logger.error("致命的なエラー", { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
