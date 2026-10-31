import type { AlertBlock } from '@/lib/alert-content';

export function AlertContent({ blocks }: { blocks: AlertBlock[] }) {
  const inline = (block: AlertBlock) => block.content.map((part, i) => part.href
    ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{part.text}<span className="sr-only"> (opens in new tab)</span></a>
    : part.text);
  return <div className="space-y-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
    {blocks.map((block, i) => block.kind === 'list-item'
      ? <ul key={i} className="list-disc pl-5"><li>{inline(block)}</li></ul>
      : <p key={i}>{inline(block)}</p>)}
  </div>;
}
