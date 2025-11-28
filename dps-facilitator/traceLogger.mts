import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import util from "node:util";

const resolveTracePath = () => {
  const envPath = process.env.TRACE_LOG_PATH;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.resolve(process.cwd(), "../trace.log");
};

const traceFilePath = resolveTracePath();

try {
  mkdirSync(path.dirname(traceFilePath), { recursive: true });
} catch {
  // ignore mkdir errors here; append will surface issues later
}

const formatPart = (part: unknown) => {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "number" || typeof part === "bigint" || typeof part === "boolean") {
    return String(part);
  }
  if (part instanceof Error) {
    return `${part.name}: ${part.message}`;
  }
  return util.inspect(part, { depth: 5, breakLength: 120, colors: false });
};

export const traceLog = (...parts: unknown[]) => {
  const line = parts.map(formatPart).join(" ");
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  appendFileSync(traceFilePath, entry, { encoding: "utf8" });
};

export const getTraceLogPath = () => traceFilePath;
