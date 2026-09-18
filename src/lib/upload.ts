/**
 * Multipart upload reading, shared by the two CSV endpoints (Day 4).
 *
 * The file is re-uploaded on the commit step instead of being stored anywhere:
 * a testimonial export is a few hundred kilobytes, the user is looking at it,
 * and keeping uploads out of Storage means no bucket, no lifecycle rule, and no
 * second copy of customer quotes sitting around on a free tier.
 */

import { MAX_CSV_BYTES } from "@/lib/csv";

export type ParsedUpload = {
  text: string;
  fileName: string;
  /** Plain text form fields that came with the file (e.g. the mapping JSON). */
  fields: Record<string, string>;
};

export type UploadError = { error: string; status: number };

export function uploadFailed(result: ParsedUpload | UploadError): result is UploadError {
  return "status" in result;
}

export async function readCsvUpload(request: Request): Promise<ParsedUpload | UploadError> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: "Send the file as multipart/form-data.", status: 400 };
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return { error: "No file in this upload.", status: 400 };
  }
  if (entry.size === 0) {
    return { error: "That file is empty.", status: 422 };
  }
  if (entry.size > MAX_CSV_BYTES) {
    return {
      error: `That file is larger than ${Math.round(MAX_CSV_BYTES / 1000)} KB. Export 500 rows at a time.`,
      status: 413,
    };
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }

  return {
    text: await entry.text(),
    fileName: entry.name || "upload.csv",
    fields,
  };
}
