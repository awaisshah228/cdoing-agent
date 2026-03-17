/**
 * DialogTheme — theme picker dialog (Ctrl+T)
 *
 * Three sections navigable with Tab:
 *   1. Appearance — Dark / Light mode toggle (OpenTUI <select>)
 *   2. Custom Background — hex input + preset picker (<select>)
 *   3. Color Themes — search + browse built-in themes (<select>)
 */

import { TextAttributes } from "@opentui/core";
import type { SelectOption } from "@opentui/core";
import { useState, useMemo } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme, THEMES, getThemeIds } from "../context/theme";

type Section = "mode" | "custombg" | "themes";
const SECTIONS: Section[] = ["mode", "custombg", "themes"];

/** Preset background colors with names for autocomplete */
const BG_PRESETS: Array<{ hex: string; name: string }> = [
  { hex: "#000000", name: "Black" },
  { hex: "#0a0a0a", name: "AMOLED Black" },
  { hex: "#0d1117", name: "GitHub Dark" },
  { hex: "#1a1b26", name: "Tokyo Night" },
  { hex: "#1e1e2e", name: "Catppuccin" },
  { hex: "#191724", name: "Rosé Pine" },
  { hex: "#282828", name: "Gruvbox" },
  { hex: "#282a36", name: "Dracula" },
  { hex: "#263238", name: "Material" },
  { hex: "#262335", name: "Synthwave" },
  { hex: "#272822", name: "Monokai" },
  { hex: "#2d353b", name: "Everforest" },
  { hex: "#2e3440", name: "Nord" },
  { hex: "#002b36", name: "Solarized Dark" },
  { hex: "#193549", name: "Cobalt2" },
  { hex: "#032424", name: "Dark Teal" },
  { hex: "#1a1a2e", name: "Midnight Blue" },
  { hex: "#0f0f23", name: "Deep Space" },
  { hex: "#1b2838", name: "Steam" },
  { hex: "#2b2b2b", name: "VS Code Dark" },
  { hex: "#fdf6e3", name: "Solarized Light" },
  { hex: "#ffffff", name: "White" },
  { hex: "#f5f5f5", name: "Light Gray" },
  { hex: "#eff1f5", name: "Catppuccin Latte" },
];

/** Convert BG_PRESETS to SelectOption format */
const BG_SELECT_OPTIONS: SelectOption[] = BG_PRESETS.map((p) => ({
  name: `${p.hex}  ${p.name}`,
  description: "",
  value: p.hex,
}));

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
  const [bgInput, setBgInput] = useState(customBg || "");
  const [query, setQuery] = useState("");

  // Mode select options
  const modeOptions: SelectOption[] = useMemo(() => [
    { name: "Dark Mode", description: mode === "dark" ? "active" : "", value: "dark" },
    { name: "Light Mode", description: mode === "light" ? "active" : "", value: "light" },
  ], [mode]);

  // Filtered BG presets based on input
  const filteredBgOptions: SelectOption[] = useMemo(() => {
    if (!bgInput) return BG_SELECT_OPTIONS;
    const q = bgInput.toLowerCase();
    return BG_SELECT_OPTIONS.filter((o) =>
      o.value.toLowerCase().startsWith(q) ||
      o.name.toLowerCase().includes(q)
    );
  }, [bgInput]);

  // Filtered theme options
  const filteredThemeOptions: SelectOption[] = useMemo(() => {
    const ids = query
      ? themeIds.filter((id) => {
          const def = THEMES[id];
          const q = query.toLowerCase();
          return id.toLowerCase().includes(q) || def.name.toLowerCase().includes(q);
        })
      : themeIds;
    return ids.map((id) => {
      const def = THEMES[id];
      return {
        name: def.name,
        description: id === themeId ? "* current" : id,
        value: id,
      };
    });
  }, [query, themeIds, themeId]);

  const nextSection = () => {
    setSection((s) => {
      const idx = SECTIONS.indexOf(s);
      return SECTIONS[(idx + 1) % SECTIONS.length];
    });
  };

  const isValidHex = (s: string): boolean => /^#[0-9a-fA-F]{6}$/.test(s);

  // Only handle Tab, Escape, and text input for custombg/themes search
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

    // ── Custom BG text input ──
    if (section === "custombg") {
      // Don't capture up/down/return (let <select> handle those)
      if (key.name === "up" || key.name === "down" || key.name === "return") return;
      if (key.name === "backspace") {
        setBgInput((s) => s.slice(0, -1));
        return;
      }
      if (key.ctrl && key.name === "u") {
        setBgInput("");
        setCustomBg(null);
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setBgInput((s) => {
          const next = s + key.sequence;
          if (isValidHex(next)) setCustomBg(next);
          return next;
        });
        return;
      }
      return;
    }

    // ── Themes search input ──
    if (section === "themes") {
      // Don't capture up/down/return (let <select> handle those)
      if (key.name === "up" || key.name === "down" || key.name === "return") return;
      if (key.name === "backspace") {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setQuery((q) => q + key.sequence);
        return;
      }
      return;
    }

    // Mode section: let <select> handle everything
  });

  const dialogWidth = Math.min(60, (dims.width || 80) - 4);
  const selectHeight = Math.max(3, Math.floor((dims.height || 24) * 0.2));

  return (
    <box
      borderStyle="double"
      borderColor={t.primary}
      backgroundColor={customBg || t.bg}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      position="absolute"
      top={Math.max(1, Math.floor((dims.height || 24) * 0.1))}
      left={Math.max(1, Math.floor(((dims.width || 80) - dialogWidth) / 2))}
      width={dialogWidth}
    >
      <text fg={t.primary} attributes={TextAttributes.BOLD}>
        {"  Themes"}
      </text>
      <text fg={t.textDim}>
        {`  Mode: ${mode}  •  ${filteredThemeOptions.length} themes${customBg ? `  •  BG: ${customBg}` : ""}`}
      </text>
      <text>{""}</text>

      {/* ── Appearance ── */}
      <text
        fg={section === "mode" ? t.primary : t.textDim}
        attributes={section === "mode" ? TextAttributes.BOLD : undefined}
      >
        {"  Appearance"}
      </text>
      <select
        options={modeOptions}
        focused={section === "mode"}
        selectedIndex={mode === "dark" ? 0 : 1}
        height={2}
        showDescription={false}
        backgroundColor={customBg || undefined}
        textColor={t.textMuted}
        selectedBackgroundColor={t.primary}
        selectedTextColor={t.bg}
        onSelect={(_index: number, option: SelectOption | null) => {
          if (option?.value) {
            setMode(option.value as "dark" | "light");
            nextSection();
          }
        }}
      />
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
        <>
          <text fg={t.textDim}>{"    Type #hex, Ctrl+U clear, ↑↓ presets, Enter apply"}</text>
          <select
            options={filteredBgOptions}
            focused={section === "custombg"}
            height={Math.min(6, filteredBgOptions.length)}
            showDescription={false}
            backgroundColor={customBg || undefined}
            textColor={t.textMuted}
            selectedBackgroundColor={t.primary}
            selectedTextColor={t.bg}
            showScrollIndicator={filteredBgOptions.length > 6}
            onChange={(_index: number, option: SelectOption | null) => {
              if (option?.value) {
                setCustomBg(option.value);
              }
            }}
            onSelect={(_index: number, option: SelectOption | null) => {
              if (option?.value) {
                setBgInput(option.value);
                setCustomBg(option.value);
                nextSection();
              }
            }}
          />
        </>
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
          <text fg={t.textMuted}>{"    Search: "}</text>
          <text fg={t.text}>{query || ""}</text>
          <text fg={t.primary} attributes={TextAttributes.BOLD}>{"_"}</text>
        </box>
      )}
      <select
        options={filteredThemeOptions}
        focused={section === "themes"}
        height={selectHeight}
        showDescription={true}
        backgroundColor={customBg || undefined}
        textColor={t.text}
        selectedBackgroundColor={t.primary}
        selectedTextColor={t.bg}
        descriptionColor={t.textDim}
        showScrollIndicator={filteredThemeOptions.length > selectHeight}
        onChange={(_index: number, option: SelectOption | null) => {
          if (option?.value) setThemeId(option.value);
        }}
        onSelect={(_index: number, _option: SelectOption | null) => {
          props.onClose();
        }}
      />

      <text>{""}</text>
      <text fg={t.textDim}>{"  Tab Section  ↑↓ Navigate  Enter Select  Esc Cancel"}</text>
    </box>
  );
}
