/**
 * DialogTheme — theme picker dialog (Ctrl+T)
 *
 * Three sections navigable with Tab:
 *   1. Appearance — Dark / Light mode toggle
 *   2. Custom Background — type a hex color for terminal bg (or clear to use theme default)
 *   3. Color Themes — browse / search built-in themes with live preview
 */

import { TextAttributes } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme, THEMES, getThemeIds } from "../context/theme";

type Section = "mode" | "custombg" | "themes";
const SECTIONS: Section[] = ["mode", "custombg", "themes"];

export function DialogTheme(props: {
  onClose: () => void;
}) {
  const { theme, themeId, mode, customBg, setThemeId, setMode, setCustomBg } = useTheme();
  const t = theme;
  const dims = useTerminalDimensions();

  const initialThemeId = themeId;
  const initialMode = mode;
  const initialCustomBg = customBg;
  const themeIds = getThemeIds();

  const [section, setSection] = useState<Section>("mode");
  const [modeSelected, setModeSelected] = useState<number>(mode === "dark" ? 0 : 1);
  const [bgInput, setBgInput] = useState(customBg || "");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(
    Math.max(0, themeIds.indexOf(themeId))
  );

  const filtered = useMemo(() => {
    if (!query) return themeIds;
    const q = query.toLowerCase();
    return themeIds.filter((id) => {
      const def = THEMES[id];
      return id.toLowerCase().includes(q) || def.name.toLowerCase().includes(q);
    });
  }, [query, themeIds]);

  const clampedSelected = Math.min(selected, Math.max(0, filtered.length - 1));

  const maxVisible = Math.max(5, Math.min(filtered.length, (dims.height || 24) - 18));
  const scrollOffset = Math.max(0, clampedSelected - maxVisible + 3);
  const visibleItems = filtered.slice(scrollOffset, scrollOffset + maxVisible);

  const modeOptions: Array<{ id: "dark" | "light"; label: string }> = [
    { id: "dark", label: "Dark Mode" },
    { id: "light", label: "Light Mode" },
  ];

  const nextSection = () => {
    setSection((s) => {
      const idx = SECTIONS.indexOf(s);
      return SECTIONS[(idx + 1) % SECTIONS.length];
    });
  };

  const isValidHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

  useKeyboard((key: any) => {
    if (key.name === "escape") {
      setThemeId(initialThemeId);
      setMode(initialMode);
      setCustomBg(initialCustomBg);
      props.onClose();
      return;
    }

    if (key.name === "tab") {
      nextSection();
      return;
    }

    // ── Mode section ──
    if (section === "mode") {
      if (key.name === "up" || key.name === "k") {
        setModeSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (key.name === "down" || key.name === "j") {
        setModeSelected((s) => Math.min(modeOptions.length - 1, s + 1));
        return;
      }
      if (key.name === "return") {
        setMode(modeOptions[modeSelected].id);
        nextSection();
        return;
      }
      return;
    }

    // ── Custom BG section ──
    if (section === "custombg") {
      if (key.name === "return") {
        if (bgInput === "" || bgInput === "none") {
          setCustomBg(null);
        } else if (isValidHex(bgInput)) {
          setCustomBg(bgInput);
        }
        nextSection();
        return;
      }
      if (key.name === "backspace") {
        setBgInput((s) => s.slice(0, -1));
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setBgInput((s) => {
          const next = s + key.sequence;
          // Live preview if valid hex
          if (isValidHex(next)) {
            setCustomBg(next);
          }
          return next;
        });
        return;
      }
      return;
    }

    // ── Themes section ──
    if (key.name === "return") {
      props.onClose();
      return;
    }

    if (key.name === "up" || (key.name === "k" && !query)) {
      setSelected((s) => {
        const next = Math.max(0, s - 1);
        const id = filtered[next];
        if (id) setThemeId(id);
        return next;
      });
      return;
    }

    if (key.name === "down" || (key.name === "j" && !query)) {
      setSelected((s) => {
        const next = Math.min(filtered.length - 1, s + 1);
        const id = filtered[next];
        if (id) setThemeId(id);
        return next;
      });
      return;
    }

    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      setSelected(0);
      return;
    }

    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => {
        const newQ = q + key.sequence;
        const q2 = newQ.toLowerCase();
        const first = themeIds.find((id) => {
          const def = THEMES[id];
          return id.toLowerCase().includes(q2) || def.name.toLowerCase().includes(q2);
        });
        if (first) setThemeId(first);
        return newQ;
      });
      setSelected(0);
    }
  });

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top="10%"
      left="20%"
      width="60%"
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Themes"}
      </text>
      <text fg={t.textDim}>
        {`  Mode: ${mode}  •  ${filtered.length} themes${customBg ? `  •  BG: ${customBg}` : ""}`}
      </text>
      <text>{""}</text>

      {/* ── Appearance ── */}
      <text
        fg={section === "mode" ? t.primary : t.textDim}
        attributes={section === "mode" ? TextAttributes.BOLD : undefined}
      >
        {"  Appearance"}
      </text>
      {modeOptions.map((opt, i) => {
        const isSel = section === "mode" && i === modeSelected;
        const isActive = opt.id === mode;
        return (
          <box key={opt.id} flexDirection="row">
            <text
              fg={isSel ? t.primary : t.text}
              attributes={isSel ? TextAttributes.BOLD : undefined}
            >
              {`    ${isSel ? ">" : " "} ${opt.label}`}
            </text>
            {isActive && <text fg={t.success}>{" *"}</text>}
          </box>
        );
      })}
      <text>{""}</text>

      {/* ── Custom Background ── */}
      <text
        fg={section === "custombg" ? t.primary : t.textDim}
        attributes={section === "custombg" ? TextAttributes.BOLD : undefined}
      >
        {"  Custom Background"}
      </text>
      <box flexDirection="row">
        <text fg={t.textMuted}>{"    Hex: "}</text>
        {section === "custombg" ? (
          <>
            <text fg={isValidHex(bgInput) ? t.success : t.text}>{bgInput || ""}</text>
            <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
          </>
        ) : (
          <text fg={customBg ? t.success : t.textDim}>{customBg || "(theme default)"}</text>
        )}
      </box>
      {section === "custombg" && (
        <text fg={t.textDim}>{"    Type #rrggbb hex, empty to clear. Enter to apply."}</text>
      )}
      <text>{""}</text>

      {/* ── Color Themes ── */}
      <text
        fg={section === "themes" ? t.primary : t.textDim}
        attributes={section === "themes" ? TextAttributes.BOLD : undefined}
      >
        {"  Color Themes"}
      </text>

      {section === "themes" && (
        <box flexDirection="row">
          <text fg={t.textMuted}>{"    > "}</text>
          <text fg={t.text}>{query || ""}</text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
        </box>
      )}

      {visibleItems.length > 0 ? (
        visibleItems.map((id) => {
          const def = THEMES[id];
          const idx = filtered.indexOf(id);
          const isSel = section === "themes" && idx === clampedSelected;
          const isCurrent = id === themeId;

          return (
            <box key={id} flexDirection="row">
              <text
                fg={isSel ? t.primary : t.text}
                attributes={isSel ? TextAttributes.BOLD : undefined}
              >
                {`    ${isSel ? ">" : " "} ${def.name}`}
              </text>
              <text fg={t.textDim}>{`  ${id}`}</text>
              {isCurrent && <text fg={t.success}>{" *"}</text>}
            </box>
          );
        })
      ) : (
        <text fg={t.textDim}>{"    No matching themes"}</text>
      )}

      {filtered.length > maxVisible && (
        <text fg={t.textDim}>
          {`    ... ${filtered.length - maxVisible} more`}
        </text>
      )}

      <text>{""}</text>
      <text fg={t.textDim}>{"  Tab Switch section  Up/Down Navigate  Enter Select  Esc Cancel"}</text>
    </box>
  );
}
