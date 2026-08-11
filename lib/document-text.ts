/** Decodes Korean office text files without silently replacing invalid UTF-8. */
export function decodeDocumentText(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // WHATWG's euc-kr decoder includes the CP949 mappings commonly used by Korean Windows tools.
    return new TextDecoder("euc-kr").decode(bytes);
  }
}
