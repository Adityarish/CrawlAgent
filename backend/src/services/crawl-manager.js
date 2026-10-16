import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrawlRun } from "../models/CrawlRun.js";
import { Source } from "../models/Source.js";
import { importJobsFromFile } from "./job-importer.js";
import { syncSourcesFromFile } from "./source-sync.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../../..");

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

class CrawlManager {
  process = null;
  runId = null;

  async start(companyName = null) {
    if (this.process && this.process.exitCode === null) {
      throw new Error("A crawl is already running.");
    }

    await syncSourcesFromFile();
    const sources = await Source.find().sort({ company: 1, url: 1 }).lean();
    const normalizeCompany = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const targetKey = companyName ? normalizeCompany(companyName) : null;
    const selectedSources = sources.filter((source) => targetKey
      ? normalizeCompany(source.company) === targetKey
      : source.active !== false);
    if (!selectedSources.length) {
      throw new Error(targetKey ? `No career sources found for ${companyName}.` : "No active career sources are configured.");
    }

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "jobatlas-crawl-"));
    const urlsFile = path.join(tempDirectory, "career_urls.txt");
    await fs.writeFile(
      urlsFile,
      `${selectedSources.map(({ company, url }) => `${company} | ${url}`).join("\n")}\n`,
      "utf8"
    );
    const run = await CrawlRun.create({
      state: "running",
      startedAt: new Date(),
      targetCompany: companyName || null,
      logs: [],
    });
    const runId = run.id;
    this.runId = run.id;
    const python = process.env.PYTHON_BIN || path.join(projectRoot, "venv/bin/python");
    const args = ["-u", "-m", "crawler", "--urls", urlsFile];
    if (companyName) args.push("--force-crawl");
    this.process = spawn(python, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = this.process;
    await CrawlRun.updateOne({ _id: runId }, { $set: { processId: child.pid } });

    const cleanTempFiles = () => fs.rm(tempDirectory, { recursive: true, force: true })
      .catch((error) => console.error("Unable to remove temporary crawl source list:", error.message));

    let stdoutBuffer = "";
    const capture = (chunk, isStdout = false) => {
      const buffered = isStdout ? stdoutBuffer + chunk.toString() : chunk.toString();
      const splitLines = buffered.split(/\r?\n/);
      if (isStdout) stdoutBuffer = splitLines.pop() || "";
      const lines = splitLines.filter(Boolean);
      if (!lines.length) return;
      CrawlRun.updateOne(
        { _id: runId },
        { $push: { logs: { $each: lines, $slice: -100 } } }
      ).catch((error) => console.error("Unable to save crawl logs:", error.message));

      if (isStdout && lines.some((line) => line.startsWith("FEED_CHECKPOINT_COMPLETE:"))) {
        importJobsFromFile()
          .then(({ imported }) => CrawlRun.updateOne(
            { _id: runId },
            { $set: { importedJobs: imported } }
          ))
          .catch((error) => CrawlRun.updateOne(
            { _id: runId },
            { $push: { logs: `Incremental MongoDB import failed: ${error.message}` } }
          ));
      }
    };

    child.stdout.on("data", (chunk) => capture(chunk, true));
    child.stderr.on("data", capture);
    child.on("error", async (error) => {
      await CrawlRun.updateOne({ _id: runId }, {
        $set: { state: "failed", finishedAt: new Date(), exitCode: -1 },
        $push: { logs: `Unable to start crawler: ${error.message}` },
      });
      await cleanTempFiles();
      if (this.runId === runId) this.process = null;
    });
    child.on("close", async (exitCode) => {
      let importedJobs = 0;
      let state = exitCode === 0 ? "succeeded" : "failed";
      if (exitCode === 0) {
        try {
          ({ imported: importedJobs } = await importJobsFromFile());
        } catch (error) {
          state = "failed";
          await CrawlRun.updateOne(
            { _id: runId },
            { $push: { logs: `MongoDB import failed: ${error.message}` } }
          );
        }
      }
      await CrawlRun.updateOne(
        { _id: runId },
        { $set: { state, exitCode, importedJobs, finishedAt: new Date() } }
      );
      await cleanTempFiles();
      if (this.runId === runId) this.process = null;
    });

    return run;
  }

  async status() {
    const run = await CrawlRun.findOne().sort({ createdAt: -1 });
    if (!run || run.state !== "running") return run;
    if (this.runId === run.id && this.process && this.process.exitCode === null) return run;
    if (processExists(run.processId)) return run;

    await CrawlRun.updateOne(
      { _id: run._id, state: "running" },
      {
        $set: { state: "failed", finishedAt: new Date() },
        $push: { logs: "Marked failed because the crawler process is no longer running." },
      }
    );
    return CrawlRun.findById(run._id);
  }

  async skipCurrent() {
    if (!this.process || this.process.exitCode !== null) {
      throw new Error("No crawl is currently running.");
    }
    if (!this.process.kill("SIGUSR1")) {
      throw new Error("The crawler did not accept the skip request.");
    }
    await CrawlRun.updateOne(
      { _id: this.runId },
      { $push: { logs: "Skip requested by admin; advancing after the current request is cancelled." } }
    );
    return this.status();
  }

  async setCompanyPaused(companyName, paused) {
    const normalizeCompany = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const key = normalizeCompany(companyName);
    if (!key) throw new Error("Company name is required.");
    const sources = await Source.find().select({ _id: 1, company: 1 }).lean();
    const matchingIds = sources
      .filter((source) => normalizeCompany(source.company) === key)
      .map((source) => source._id);
    if (!matchingIds.length) throw new Error(`No career sources found for ${companyName}.`);
    await Source.updateMany({ _id: { $in: matchingIds } }, { $set: { active: !paused } });
    return { company: companyName, paused, sourcesUpdated: matchingIds.length };
  }
}

export const crawlManager = new CrawlManager();
