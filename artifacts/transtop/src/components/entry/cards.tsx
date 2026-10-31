/* Original card artwork inspired by regional stored-value cards. Not official marks. */
const shadow = 'drop-shadow-[0_12px_24px_rgba(0,0,0,.55)]';

export function LondonCard() {
  return (
    <svg viewBox="0 0 160 100" className={`block h-auto w-full ${shadow}`} aria-hidden>
      <rect width="160" height="100" rx="8" fill="#2aa4e8" />
      <path d="M104 0 H152 a8 8 0 0 1 8 8 V92 a8 8 0 0 1 -8 8 H96 C122 72 124 30 104 0Z" fill="#12236b" />
      <path d="M100 0 C120 30 118 72 92 100" stroke="#f4f1ea" strokeWidth="4" fill="none" />
      <text x="14" y="40" fontFamily="Outfit, sans-serif" fontWeight="700" fontSize="26" fill="#12236b">tapcard</text>
      <text x="14" y="58" fontFamily="Outfit, sans-serif" fontSize="8" fill="#12236b">Transtop · visual only</text>
      <circle cx="136" cy="78" r="9" fill="none" stroke="#f4f1ea" strokeWidth="3" />
      <rect x="123" y="76" width="26" height="4" fill="#f4f1ea" />
    </svg>
  );
}

export function ParisCard() {
  return (
    <svg viewBox="0 0 160 100" className={`block h-auto w-full ${shadow}`} aria-hidden>
      <rect width="160" height="100" rx="8" fill="#3d8de0" />
      <path d="M112 0 H152 a8 8 0 0 1 8 8 V92 a8 8 0 0 1 -8 8 H100 C126 70 128 32 112 0Z" fill="#0f2f78" />
      <path d="M106 0 C124 32 122 70 96 100" stroke="#f4f1ea" strokeWidth="3.5" fill="none" />
      <text x="14" y="38" fontFamily="Outfit, sans-serif" fontWeight="700" fontSize="24" fill="#f4f1ea">passe</text>
      <circle cx="40" cy="58" r="5" fill="#f4f1ea" />
      <path d="M22 84 C34 74 40 70 44 62 L56 68 M38 66 L30 58" stroke="#f4f1ea" strokeWidth="4" strokeLinecap="round" fill="none" />
      <circle cx="136" cy="78" r="10" fill="none" stroke="#f4f1ea" strokeWidth="2.5" />
      <path d="M130 80 C134 72 140 72 142 78" stroke="#f4f1ea" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function TokyoCard() {
  return (
    <svg viewBox="0 0 160 100" className={`block h-auto w-full ${shadow}`} aria-hidden>
      <rect width="160" height="100" rx="8" fill="#eef0ec" />
      <path d="M0 8 a8 8 0 0 1 8 -8 H86 L44 100 H8 a8 8 0 0 1 -8 -8Z" fill="#3fb24a" />
      <rect x="10" y="68" width="66" height="22" rx="3" fill="#3fb24a" />
      <text x="13" y="84" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="12" fill="#f4f1ea">Transtop</text>
      <text x="128" y="20" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="11" fill="#3fb24a">TT</text>
      {/* original penguin-like commuter bird */}
      <ellipse cx="126" cy="66" rx="13" ry="20" fill="#1b1d22" />
      <ellipse cx="128" cy="70" rx="8" ry="14" fill="#f4f1ea" />
      <circle cx="129" cy="54" r="2" fill="#f4f1ea" /><circle cx="129.5" cy="54" r="1" fill="#1b1d22" />
      <path d="M134 57 L142 59 L134 61Z" fill="#f2a516" />
      <path d="M118 86 L124 88 M130 88 L136 86" stroke="#f2a516" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
