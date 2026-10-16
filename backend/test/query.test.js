import assert from "node:assert/strict";
import test from "node:test";
import { buildJobQuery } from "../src/routes/public.js";
import { normalizeJob } from "../src/services/job-importer.js";
import { parseSources } from "../src/services/source-sync.js";

test("buildJobQuery maps filters without exposing raw regular expressions", () => {
  const filter = buildJobQuery({
    search: "node.*",
    company: "Amazon,Flipkart",
    location: "Bengaluru",
    fresher: "true",
  });
  assert.deepEqual(filter.companyName.$in, ["Amazon", "Flipkart"]);
  assert.deepEqual(filter.city.$in, ["Bengaluru"]);
  assert.equal(filter.$or[0].title.source, "node\\.\\*");
  assert.ok(filter.$and);
});

test("normalizeJob maps crawler snake case fields to Mongo fields", () => {
  const job = normalizeJob({
    external_id: "ABC",
    company_name: "Acme",
    title: "Engineer",
    description: "Build things",
    full_location_text: "Pune, India",
    application_url: "https://acme.example/apply",
    source_url: "https://acme.example/jobs",
  });
  assert.equal(job.externalId, "ABC");
  assert.equal(job.companyName, "Acme");
  assert.equal(job.city, null);
  assert.equal(job.fingerprint.length, 64);
});

test("parseSources supports named and plain career URLs", () => {
  const sources = parseSources("Acme | https://acme.example/jobs\nhttps://jobs.example.org/openings\n");
  assert.equal(sources.length, 2);
  assert.equal(sources[0].company, "Acme");
  assert.equal(sources[1].company, "example");
});
