/** Provider markup is tokenized as text, never inserted into a browser document. */
export type AlertInline = { text: string; href?: string };
export type AlertBlock = { kind: 'paragraph' | 'list-item'; content: AlertInline[] };

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©',
  reg: '®', trade: '™', zwnj: '', zwj: '', lrm: '', rlm: '',
  ensp: ' ', emsp: ' ', thinsp: ' ', NewLine: '\n', Tab: ' ',
};

export function decodeAlertText(text: string): string {
  // Bounded repeated decoding handles feeds that double-encode their entities.
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, name: string) => {
      if (name[0] !== '#') return ENTITIES[name] ?? raw;
      const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    });
    if (next === text) break;
    text = next;
  }
  return text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '');
}

export function safeAlertUrl(raw: string): string | undefined {
  const value = decodeAlertText(raw).trim();
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    return url.href;
  } catch { return; }
}

const BLOCKED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript']);
const BOUNDARY = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'tr']);

export function alertBlocks(raw: string): AlertBlock[] {
  const blocks: AlertBlock[] = [];
  let content: AlertInline[] = [], kind: AlertBlock['kind'] = 'paragraph', href: string | undefined;
  const blocked: string[] = [];
  const flush = () => {
    if (content.some(p => p.text.trim()) && blocks.length < 250) blocks.push({ kind, content });
    content = [];
  };
  const addText = (rawText: string) => {
    const lines = decodeAlertText(rawText).replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i) flush();
      const text = line.replace(/[ \t]+/g, ' ');
      if (href) content.push({ text, href });
      else {
        // Preserve plain-text official links as well as agency anchors.
        for (const part of text.split(/(https?:\/\/[^\s<>]+)/gi)) {
          const match = part.match(/^(https?:\/\/.*?)([.,;!?)]*)$/i);
          const url = match && safeAlertUrl(match[1]);
          content.push(url ? { text: match![1], href: url } : { text: part });
          if (url && match![2]) content.push({ text: match![2] });
        }
      }
    });
  };
  // Decode before tokenizing so encoded markup is subject to the same discard rules.
  const input = decodeAlertText(raw.slice(0, 60_000));
  for (const token of input.match(/<!--[\s\S]*?(?:-->|$)|<[^>]*(?:>|$)|[^<]+|</g) ?? []) {
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<') || token === '<') { if (!blocked.length) addText(token); continue; }
    const tag = token.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/i);
    if (!tag) continue;
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (BLOCKED.has(name)) {
      if (closing) {
        const at = blocked.lastIndexOf(name);
        if (at >= 0) blocked.splice(at);
      } else if (!/\/>$/.test(token) && !['embed'].includes(name)) blocked.push(name);
      continue;
    }
    if (blocked.length) continue;
    if (BOUNDARY.has(name) || name === 'br' || name === 'hr') {
      flush();
      kind = name === 'li' && !closing ? 'list-item' : 'paragraph';
    }
    if (name === 'a') {
      href = undefined;
      if (!closing) {
        const attr = token.match(/\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        if (attr) href = safeAlertUrl(attr[1] ?? attr[2] ?? attr[3]);
      }
    }
  }
  flush();
  return blocks;
}

export const blockText = (block: AlertBlock) => block.content.map(p => p.text).join('').trim();
const comparable = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.!:]+$/, '').toLocaleLowerCase();

export function formatAlertContent(title: string, description: string) {
  const heading = alertBlocks(title).map(blockText).join(' ') || 'Service alert';
  const blocks = alertBlocks(description);
  while (blocks.length) {
    const first = blockText(blocks[0]);
    if (comparable(first) === comparable(heading)) { blocks.shift(); continue; }
    // Some feeds repeat the title and then continue the same paragraph.
    if (first.toLocaleLowerCase().startsWith(heading.toLocaleLowerCase()) && /^[\s.!:–—-]/.test(first.slice(heading.length))) {
      let remaining = heading.length;
      blocks[0].content = blocks[0].content.map(part => {
        const cut = Math.min(remaining, part.text.length);
        remaining -= cut;
        return { ...part, text: part.text.slice(cut) };
      });
      const firstPart = blocks[0].content.find(p => p.text.length);
      if (firstPart) firstPart.text = firstPart.text.replace(/^[\s.!:–—-]+/, '');
    }
    break;
  }
  return { title: heading, blocks };
}
