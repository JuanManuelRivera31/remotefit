const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(160),
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Converts job-posting HTML to plain text. Pass `escaped: true` for Greenhouse, whose `content`
 * arrives entity-escaped (`&lt;p&gt;`) and must be decoded once before the tags can be removed.
 */
export function htmlToText(html: string, options: { escaped?: boolean } = {}): string {
  const source = options.escaped ? decodeEntities(html) : html;
  const text = source
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|ul|ol|li|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
