import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export type MoreItem =
  | { kind: "action"; icon: IconName; label: string; shortcut?: string; onSelect: () => void }
  | { kind: "divider" };

/** The top bar's overflow menu: less-frequent actions. */
export function MoreMenu({ items, label = "More", icon = "more", disabled = false }: { items: MoreItem[]; label?: string; icon?: IconName; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>(".menu-trigger")?.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);

  return (
    <div className="more" ref={ref}>
      <button
        className={`icon-btn menu-trigger ${open ? "on" : ""}`}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <Icon name={icon} />
      </button>
      {open && (
        <div className="menu dropdown" role="menu" aria-label={label} onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
          buttons[next]?.focus();
        }}>
          {items.map((item, i) =>
            item.kind === "divider" ? (
              <hr key={i} />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                aria-label={item.label}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={15} />
                <span className="menu-label">{item.label}</span>
                {item.shortcut && <kbd className="menu-kbd">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
