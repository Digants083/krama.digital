/** Flat waiting-room cartoon — two people on a bench, plant, armchair */
const WaitingRoomIllustration = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 360 140"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect x="0" y="98" width="360" height="42" fill="#e8ebe4" />
    <rect x="0" y="0" width="360" height="98" fill="#f3f5ef" />

    <rect x="268" y="28" width="72" height="70" rx="4" fill="#dce3d8" />
    <rect x="276" y="36" width="56" height="62" rx="2" fill="#eef2ea" />

    <rect x="24" y="62" width="52" height="36" rx="10" fill="#3d7a5c" />
    <rect x="30" y="52" width="40" height="22" rx="12" fill="#4a8f6a" />
    <rect x="22" y="88" width="14" height="10" rx="4" fill="#3d7a5c" />
    <rect x="64" y="88" width="14" height="10" rx="4" fill="#3d7a5c" />

    <rect x="118" y="78" width="124" height="14" rx="6" fill="#4a8f6a" />
    <rect x="128" y="92" width="10" height="12" rx="3" fill="#3d7a5c" />
    <rect x="222" y="92" width="10" height="12" rx="3" fill="#3d7a5c" />

    <rect x="318" y="82" width="18" height="16" rx="4" fill="#c4a882" />
    <ellipse cx="327" cy="72" rx="16" ry="18" fill="#5a9e72" />
    <ellipse cx="318" cy="66" rx="10" ry="12" fill="#6bb088" />
    <ellipse cx="336" cy="68" rx="9" ry="11" fill="#4d8a62" />

    <circle cx="152" cy="58" r="14" fill="#e8c4a8" />
    <path d="M138 72 Q152 68 166 72 L168 92 L136 92 Z" fill="#5b8fd4" />
    <rect x="144" y="88" width="8" height="14" rx="3" fill="#4a5568" />
    <rect x="156" y="88" width="8" height="14" rx="3" fill="#4a5568" />

    <circle cx="198" cy="56" r="13" fill="#ddb896" />
    <path d="M186 70 Q198 66 210 70 L212 90 L184 90 Z" fill="#c9a87c" />
    <rect x="190" y="86" width="7" height="13" rx="3" fill="#57534e" />
    <rect x="201" y="86" width="7" height="13" rx="3" fill="#57534e" />

    <circle cx="88" cy="34" r="14" fill="#eef2ea" stroke="#c5cfc0" strokeWidth="2" />
    <line x1="88" y1="34" x2="88" y2="26" stroke="#3d7a5c" strokeWidth="2" strokeLinecap="round" />
    <line x1="88" y1="34" x2="94" y2="36" stroke="#3d7a5c" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default WaitingRoomIllustration;
