import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrawlRun } from "../models/CrawlRun.js";
import { Source } from "../models/Source.js";
import { importJobsFromFile } from "./job-importer.js";

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
  paused = false;

  async start(companyName = null, sourceId = null) {
    if (this.process && this.process.exitCode === null) {
      throw new Error("A crawl is already running.");
    }

    const sources = await Source.find().sort({ company: 1, url: 1 }).lean();
    const normalizeCompany = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const targetKey = companyName ? normalizeCompany(companyName) : null;
    const selectedSources = sources.filter((source) => sourceId
      ? String(source._id) === String(sourceId) && source.active !== false
      : targetKey
      ? normalizeCompany(source.company) === targetKey
      : source.active !== false);
    if (!selectedSources.length) {
      throw new Error(sourceId
        ? "No active career source found for the selected link."
        : targetKey
          ? `No career sources found for ${companyName}.`
          : "No active career sources are configured.");
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
      targetSourceUrl: sourceId ? selectedSources[0].url : null,
      logs: [],
    });
    const runId = run.id;
    this.runId = run.id;
    this.paused = false;
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
      if (this.runId === runId) this.paused = false;
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
      if (this.runId === runId) this.paused = false;
    });

    return run;
  }

  async status() {
    const run = await CrawlRun.findOne().sort({ createdAt: -1 });
    if (!run || !["running", "paused"].includes(run.state)) return run;
    // Keep the persisted state while this API process owns the run. The child
    // may have exited while its close handler is still importing the last feed
    // checkpoint and writing the final succeeded/failed state.
    if (String(this.runId) === String(run._id) && this.process) return run;
    if (processExists(run.processId)) return run;

    await CrawlRun.updateOne(
      { _id: run._id, state: { $in: ["running", "paused"] } },
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

  async setCrawlPaused(paused) {
    if (!this.process || this.process.exitCode !== null) {
      throw new Error("No crawl is currently running.");
    }
    if (this.paused === paused) return this.status();
    if (!this.process.kill("SIGUSR2")) {
      throw new Error("The crawler did not accept the pause request.");
    }
    this.paused = paused;
    await CrawlRun.updateOne(
      { _id: this.runId },
      {
        $set: { state: paused ? "paused" : "running" },
        $push: { logs: paused ? "Pause requested; the current page will finish before the crawler waits." : "Crawl resumed by admin." },
      }
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
