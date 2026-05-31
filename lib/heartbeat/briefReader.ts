import { promises as fs } from "node:fs";
import path from "node:path";

export const BRIEF_SECTIONS = [
  "CEO Decisions",
  "System Health",
  "What Changed",
  "What Needs Dylan",
  "Not Covered Yet",
] as const;

export type BriefSectionTitle = (typeof BRIEF_SECTIONS)[number];

export type HeartbeatBrief = {
  title: string;
  sections: Record<BriefSectionTitle, string>;
  lastUpdated: Date;
};

export type HeartbeatBriefReadResult =
  | { found: true; brief: HeartbeatBrief }
  | { found: false };

const BRIEF_PATH = path.join(process.cwd(), "generated/heartbeat/brief-today.md");

function parseBriefSections(markdown: string): Record<BriefSectionTitle, string> {
  const sections = Object.fromEntries(
    BRIEF_SECTIONS.map((title) => [title, ""]),
  ) as Record<BriefSectionTitle, string>;

  for (let i = 0; i < BRIEF_SECTIONS.length; i += 1) {
    const title = BRIEF_SECTIONS[i];
    const nextTitle = BRIEF_SECTIONS[i + 1];
    const start = markdown.indexOf(`## ${title}`);
    if (start === -1) continue;

    const contentStart = markdown.indexOf("\n", start) + 1;
    const end =
      nextTitle !== undefined
        ? markdown.indexOf(`## ${nextTitle}`, contentStart)
        : markdown.length;

    sections[title] = markdown
      .slice(contentStart, end === -1 ? markdown.length : end)
      .trim();
  }

  return sections;
}

export async function readHeartbeatBriefToday(): Promise<HeartbeatBriefReadResult> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(BRIEF_PATH, "utf8"),
      fs.stat(BRIEF_PATH),
    ]);

    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Meridian Morning Brief";

    return {
      found: true,
      brief: {
        title,
        sections: parseBriefSections(content),
        lastUpdated: stat.mtime,
      },
    };
  } catch {
    return { found: false };
  }
}
