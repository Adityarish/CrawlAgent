import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrawlRun } from "../models/CrawlRun.js";
import { importJobsFromFile } from "./job-importer.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");

class CrawlManager {
  process = null;
  runId = null;

  async start() {
    if (this.process && this.process.exitCode === null) {
      throw new Error("A crawl is already running.");
    }

    const run = await CrawlRun.create({ state: "running", startedAt: new Date(), logs: [] });
    this.runId = run.id;
    const python = process.env.PYTHON_BIN || path.join(projectRoot, "venv/bin/python");
    this.process = spawn(python, ["-u", "-m", "crawler"], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      CrawlRun.updateOne(
        { _id: this.runId },
        { $push: { logs: { $each: lines, $slice: -100 } } }
      ).catch((error) => console.error("Unable to save crawl logs:", error.message));
    };

    this.process.stdout.on("data", capture);
    this.process.stderr.on("data", capture);
    this.process.on("close", async (exitCode) => {
      let importedJobs = 0;
      let state = exitCode === 0 ? "succeeded" : "failed";
      if (exitCode === 0) {
        try {
          ({ imported: importedJobs } = await importJobsFromFile());
        } catch (error) {
          state = "failed";
          await CrawlRun.updateOne(
            { _id: this.runId },
            { $push: { logs: `MongoDB import failed: ${error.message}` } }
          );
        }
      }
      await CrawlRun.updateOne(
        { _id: this.runId },
        { $set: { state, exitCode, importedJobs, finishedAt: new Date() } }
      );
      this.process = null;
    });

    return run;
  }

  async status() {
    return CrawlRun.findOne().sort({ createdAt: -1 });
  }
}

export const crawlManager = new CrawlManager();
