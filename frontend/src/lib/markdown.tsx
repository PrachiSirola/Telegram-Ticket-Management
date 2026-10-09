import type { ReactNode } from "react";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Rule = {
  re: RegExp;
  render: (m: RegExpExecArray, key: string, names: string[]) => ReactNode;
};

const RULES: Rule[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k} className="md-code">{m[1]}</code> },
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/,
    render: (m, k) => (
      <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer nofollow ugc" className="link">
        {m[1]}
      </a>
    ),
  },
  { re: /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/, render: (m, k, n) => <strong key={k}>{inline(m[1] ?? m[2], n, k)}</strong> },
  {
    re: /(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])/,
    render: (m, k, n) => <em key={k}>{inline(m[1] ?? m[2], n, k)}</em>,
  },
];

/** Inline formatting + @mentions for one line/paragraph of text. */
export function inline(text: string, memberNames: string[], keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const mentionRe = memberNames.length
    ? new RegExp(`@(?:${[...memberNames].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})`)
    : null;
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { idx: number; m: RegExpExecArray; render: Rule["render"] } | null = null;
    for (const r of RULES) {
      const m = r.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, m, render: r.render };
    }
    if (mentionRe) {
      const m = mentionRe.exec(rest);
      if (m && (best === null || m.index < best.idx)) {
        best = {
          idx: m.index,
          m,
          render: (mm, k) => (
            <span key={k} className="mention">
              {mm[0]}
            </span>
          ),
        };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    out.push(best.render(best.m, `${keyPrefix}-${n++}`, memberNames));
    rest = rest.slice(best.idx + best.m[0].length);
  }
  return out;
}

function lines(text: string, names: string[], key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  text.split("\n").forEach((l, i, arr) => {
    parts.push(...inline(l, names, `${key}-${i}`));
    if (i < arr.length - 1) parts.push(<br key={`${key}-br${i}`} />);
  });
  return parts;
}

export function Markdown({ text, memberNames = [] }: { text: string; memberNames?: string[] }) {
  const src = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < src.length && !/^```/.test(src[i])) buf.push(src[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={`b${b++}`} className="md-pre">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    // heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <p key={`b${b++}`} className={`font-semibold text-fg ${h[1].length === 1 ? "text-base" : "text-sm"}`}>
          {inline(h[2], memberNames, `h${b}`)}
        </p>,
      );
      i++;
      continue;
    }
    // quote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < src.length && /^>\s?/.test(src[i])) buf.push(src[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={`b${b++}`} className="md-quote">
          {lines(buf.join("\n"), memberNames, `q${b}`)}
        </blockquote>,
      );
      continue;
    }
    // lists
    const ul = /^\s*[-*]\s+/;
    const ol = /^\s*\d+[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      while (i < src.length && re.test(src[i])) items.push(src[i++].replace(re, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={`b${b++}`} className={`md-list ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, memberNames, `l${b}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    // paragraph (until blank line / other block)
    const buf: string[] = [];
    while (
      i < src.length &&
      src[i].trim() &&
      !/^```|^#{1,3}\s|^>\s?|^\s*[-*]\s+|^\s*\d+[.)]\s+/.test(src[i])
    ) {
      buf.push(src[i++]);
    }
    blocks.push(<p key={`b${b++}`}>{lines(buf.join("\n"), memberNames, `p${b}`)}</p>);
  }
  return <div className="md space-y-2 break-words text-sm text-fg-soft">{blocks}</div>;
}