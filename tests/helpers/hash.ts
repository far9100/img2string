import { createHash } from "node:crypto";

/** SHA-256 (hex) of a string, or of JSON.stringify(value). */
export const sha256 = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value), "utf8").digest("hex");
