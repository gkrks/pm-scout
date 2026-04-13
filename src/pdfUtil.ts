import pdfParse from "pdf-parse";

/**
 * Extract plain text from a PDF buffer.
 */
export async function extract_text_from_bytes(buf: Buffer): Promise<string> {
  const result = await pdfParse(buf);
  return result.text;
}
