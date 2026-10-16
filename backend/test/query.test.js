import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceUpload } from "../src/routes/admin.js";
import { buildJobQuery } from "../src/routes/public.js";
import { loadDistrictLocations, resolveDistrictLocations } from "../src/services/district-locations.js";
import { normalizeJob } from "../src/services/job-importer.js";
import { parseSources } from "../src/services/source-sync.js";
import { groupJobsByLocation } from "../../frontend/lib/jobLocations.js";

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
  assert.deepEqual(job.locationPoints, []);
});

test("district CSV resolves aliases and multiple job locations", async () => {
  const districts = await loadDistrictLocations();
  assert.equal(districts.length, 784);
  const locations = resolveDistrictLocations({
    city: "Bangalore, Noida, Mumbai",
    full_location_text: "Bangalore, Noida, Mumbai, India",
  }, districts);
  assert.deepEqual(locations.map((location) => location.district), ["Bengaluru Urban", "Gautam Buddha Nagar", "Mumbai"]);
  assert.deepEqual(locations.find((location) => location.district === "Bengaluru Urban"), {
    districtCode: "525",
    district: "Bengaluru Urban",
    state: "Karnataka",
    latitude: 12.951608,
    longitude: 77.592918,
    coordinateBasis: "polygon_centroid",
  });
});

test("admin source upload accepts CSV Company and Link columns", () => {
  const data = Buffer.from("Company,Link\nAcme,https://acme.example/careers\n").toString("base64");
  assert.deepEqual(parseSourceUpload({ fileName: "sources.csv", data }), [{
    source: { company: "Acme", url: "https://acme.example/careers" },
    rowNumber: 2,
  }]);
});

test("map groups jobs using imported district coordinates", () => {
  const groups = groupJobsByLocation([{
    id: "job-1",
    locationPoints: [{
      districtCode: "525",
      district: "Bengaluru Urban",
      state: "Karnataka",
      latitude: 12.951608,
      longitude: 77.592918,
      coordinateBasis: "polygon_centroid",
    }],
  }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Bengaluru Urban, Karnataka");
  assert.deepEqual(groups[0].position, [12.951608, 77.592918]);
});

test("parseSources supports named and plain career URLs", () => {
  const sources = parseSources("Acme | https://acme.example/jobs\nhttps://jobs.example.org/openings\n");
  assert.equal(sources.length, 2);
  assert.equal(sources[0].company, "Acme");
  assert.equal(sources[1].company, "example");
});
