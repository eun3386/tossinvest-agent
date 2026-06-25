import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryRecord } from "@/lib/types";

export const historyDir = path.join(process.cwd(), "history");

export async function ensureHistoryDir() {
  await fs.mkdir(historyDir, { recursive: true });
}

export async function writeHistory(record: HistoryRecord) {
  await ensureHistoryDir();
  const base = `${record.epochSeconds}.json`;
  let filename = base;
  let counter = 2;

  while (true) {
    const target = path.join(historyDir, filename);
    try {
      await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
        flag: "wx",
      });
      return filename;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      filename = `${record.epochSeconds}-${counter}.json`;
      counter += 1;
    }
  }
}

export async function listHistory(limit = 100) {
  await ensureHistoryDir();
  const files = await fs.readdir(historyDir);
  const jsonFiles = files
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .slice(-limit);

  const records = await Promise.all(
    jsonFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(historyDir, file), "utf8");
      return {
        file,
        record: JSON.parse(raw) as HistoryRecord,
      };
    }),
  );

  return records;
}
