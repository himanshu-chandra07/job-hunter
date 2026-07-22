// Extracts plain text from an uploaded resume buffer.
// Supports PDF (pdf-parse), DOCX (mammoth) and plain text (.txt/.md).
// pdf-parse is imported from its lib entry to avoid the package index's
// debug branch, which tries to read a bundled sample file under ESM.

import path from "path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const PRINTABLE = /[\x09\x0A\x0D\x20-\x7E]/;

export async function extractResumeText(buffer, filename = "", mimetype = "") {
  if (!buffer || !buffer.length) throw new Error("The uploaded file is empty.");
  const ext = path.extname(filename || "").toLowerCase();
  const mt = (mimetype || "").toLowerCase();

  if (ext === ".pdf" || mt.includes("pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return (text || "").trim();
  }

  if (
    ext === ".docx" ||
    mt.includes("officedocument.wordprocessingml")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return (value || "").trim();
  }

  if (ext === ".txt" || ext === ".md" || ext === ".text" || mt.startsWith("text/")) {
    return buffer.toString("utf8").trim();
  }

  if (ext === ".doc" || mt === "application/msword") {
    throw new Error(
      "Legacy .doc files aren't supported — please upload a PDF, DOCX, or TXT."
    );
  }

  // Unknown extension: accept it only if it looks like readable text.
  const asText = buffer.toString("utf8");
  const printable = asText.replace(/[^\x20-\x7E]/g, "").length;
  if (PRINTABLE.test(asText) && printable > asText.length * 0.6) {
    return asText.trim();
  }

  throw new Error(
    "Unsupported file type — please upload a PDF, DOCX, or TXT resume."
  );
}
