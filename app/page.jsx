import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageHtml = readFileSync(join(process.cwd(), "app", "site.html"), "utf8");
const pageMarkup = pageHtml
  .match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
  ?.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
  .replace(/<script\b[^>]*\/\s*>/gi, "");

if (!pageMarkup) throw new Error("Could not load the JobAtlas markup from app/site.html");

export default function HomePage() {
  return <div dangerouslySetInnerHTML={{ __html: pageMarkup }} />;
}
