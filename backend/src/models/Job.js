import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    externalId: { type: String, trim: true },
    companyName: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    domain: { type: String, trim: true, default: null, index: true },
    subdomain: { type: String, trim: true, default: null },
    description: { type: String, required: true, trim: true },
    summary: { type: String, trim: true, default: "" },
    responsibilities: [{ type: String }],
    requiredQualifications: [{ type: String }],
    preferredQualifications: [{ type: String }],
    educationRequirements: [{ type: String }],
    skills: [{ type: String }],
    minExperience: { type: Number, default: null },
    maxExperience: { type: Number, default: null },
    fresherEligible: { type: Boolean, default: null },
    employmentType: { type: String, default: null, index: true },
    workplaceType: { type: String, default: null, index: true },
    fullLocationText: { type: String, required: true, trim: true },
    city: { type: String, default: null, index: true },
    state: { type: String, default: null },
    country: { type: String, default: "India" },
    locationPoints: [{
      _id: false,
      districtCode: { type: String, required: true },
      district: { type: String, required: true },
      state: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      coordinateBasis: { type: String, default: null },
    }],
    salaryMin: { type: Number, default: null },
    salaryMax: { type: Number, default: null },
    salaryCurrency: { type: String, default: null },
    salaryPeriod: { type: String, default: null },
    salaryDisclosed: { type: Boolean, default: false },
    applicationUrl: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    datePosted: { type: Date, default: null, index: true },
    applicationDeadline: { type: Date, default: null },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    fingerprint: { type: String, required: true, unique: true, index: true },
    importedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

jobSchema.index({ title: "text", companyName: "text", description: "text", skills: "text" });
jobSchema.index({ companyName: 1, city: 1, datePosted: -1 });

jobSchema.set("toJSON", {
  transform(_document, value) {
    value.id = value._id.toString();
    delete value._id;
    delete value.fingerprint;
    return value;
  },
});

export const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);
