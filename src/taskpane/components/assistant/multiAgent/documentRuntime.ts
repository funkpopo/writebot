import { getDocumentText } from "../../../../utils/wordApi";

export async function safeGetDocumentText(fallback = ""): Promise<string> {
  try {
    return await getDocumentText();
  } catch {
    return fallback;
  }
}
