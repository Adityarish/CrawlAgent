import mongoose from "mongoose";

const crawlRunSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      enum: ["queued", "running", "succeeded", "failed"],
      default: "queued",
      index: true,
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    exitCode: { type: Number, default: null },
    importedJobs: { type: Number, default: 0 },
    logs: [{ type: String }],
  },
  { timestamps: true, versionKey: false }
);

crawlRunSchema.set("toJSON", {
  transform(_document, value) {
    value.id = value._id.toString();
    delete value._id;
  },
});

export const CrawlRun = mongoose.models.CrawlRun || mongoose.model("CrawlRun", crawlRunSchema);
