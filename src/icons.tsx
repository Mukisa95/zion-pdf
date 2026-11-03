const paths = {
  merge: <><path d="M5 3v5c0 3 7 3 7 7v6M19 3v5c0 3-7 3-7 7m-4 2 4 4 4-4"/></>,
  grip: <><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>,
  redo: <><path d="m15 4 5 5-5 5M20 9H10a6 6 0 0 0 0 12h3"/></>,
  move: <><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
  replaceImage: <><path d="M20 10V5H5v14h8M5 16l4-5 4 4 3-5 4 4M16 18h6m-2-2 2 2-2 2"/><circle cx="9" cy="8" r="1"/></>,
  flip: <><path d="M12 3v2m0 3v2m0 3v2m0 3v3M3 5v14l6-7-6-7ZM21 5v14l-6-7 6-7Z"/></>,
  bold: <><path d="M6 4h7a4 4 0 0 1 0 8H6V4Zm0 8h8a4 4 0 0 1 0 8H6v-8Z"/></>,
  italic: <><path d="M10 4h9M5 20h9M15 4 9 20"/></>,
  underline: <><path d="M6 4v7a6 6 0 0 0 12 0V4M4 21h16"/></>,
  alignLeft: <path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>,
  alignCenter: <path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>,
  alignRight: <path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>,
  alignJustify: <path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>,
  bulletList: <><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
  numberList: <><path d="M10 6h11M10 12h11M10 18h11M3 4h2v5M3 9h4M3 14a2 2 0 0 1 4 0c0 2-4 2-4 5h4"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  front: <><rect x="3" y="9" width="10" height="12" rx="1"/><path d="M7 9V5h10v12h-4M16 4l3-3 3 3M19 1v10"/></>,
  forward: <><rect x="3" y="9" width="10" height="12" rx="1"/><path d="M7 9V5h10v12h-4m3-9 3-3 3 3M19 5v13"/></>,
  backward: <><rect x="3" y="9" width="10" height="12" rx="1"/><path d="M7 9V5h10v12h-4m3-2 3 3 3-3M19 5v13"/></>,
  back: <><rect x="3" y="9" width="10" height="12" rx="1"/><path d="M7 9V5h10v12h-4m3 1 3 3 3-3M19 10v11"/></>,
  fontFile: <><path d="M13 3H5v18h14V9l-6-6Zm0 0v6h6M7 18l3-7 3 7M8 16h4M18 13v7m-3-4 3-3 3 3"/></>,
  scanText: <><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8V7h10v1M12 7v10M9 17h6"/></>,
  save: <><path d="M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8"/></>,
  duplicate: <><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 15v6h12V9h-6M9 6v6M6 9h6"/></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="2" width="6" height="5" rx="1"/><path d="M9 12h6M9 16h6"/></>,
  camera: <><path d="M8 6.5 9.5 4h5L16 6.5h3A2 2 0 0 1 21 8.5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  rotate: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14h10v6H7z" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  cursor: <path d="M5 3.5 19 10l-6.2 1.8L10 18z" />,
  highlight: <><path d="m14.5 4.5 5 5L11 18H6v-5z" /><path d="M3 21h18" /></>,
  signature: <><path d="M3 16.5c2-.2 3.4-8.5 5.6-8.5 1.8 0 .6 7.5 3 7.5 1.6 0 2-3.6 3.6-3.6 1.3 0 1.2 2.4 2.8 2.4 1 0 1.8-.8 3-1.8" /><path d="M3 20.5h18" /></>,
  pen: <><path d="M4 20c3-1 4.5-3 6-6s3.5-6.5 6-8 3.5 0 3 1.5-3 4-6 5.5-6 2-9 7" /></>,
  text: <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  fitWidth: <><path d="M3 12h18" /><path d="m7 8-4 4 4 4M17 8l4 4-4 4" /></>,
  fitPage: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 12h6" /></>,
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  note: <><path d="M5 4.5h14a1 1 0 0 1 1 1V15l-5 4.5H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" /><path d="M15 19.5V15h5M8 9h8M8 12.5h5" /></>,
  sparkle: <><path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  send: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  more: <><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
