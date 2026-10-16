import mongoose from "mongoose";

const sourceSchema = new mongoose.Schema(
  {
    company: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true, unique: true },
    active: { type: Boolean, default: true },
    lastCrawledAt: { type: Date, default: null },
    lastStatus: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  },
  { timestamps: true, versionKey: false }
);

sourceSchema.set("toJSON", {
  transform(_document, value) {
    value.id = value._id.toString();
    delete value._id;
  },
});

export const Source = mongoose.models.Source || mongoose.model("Source", sourceSchema);
