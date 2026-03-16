/**
 * LoadingAnimation — Braille-dot spinner like Continue CLI.
 *
 * Uses 3-character braille patterns with density-based animation
 * and smooth easing for a polished loading effect.
 */

import React, { useEffect, useState } from "react";
import { Text } from "ink";

// Braille characters ordered by dot density (0 = empty, 8 = full)
const BRAILLE_BY_DENSITY: string[][] = [
  ["⠀"],                                          // 0 dots
  ["⠁", "⠂", "⠄", "⠈", "⠐", "⠠", "⡀", "⢀"],  // 1 dot
  ["⠃", "⠅", "⠉", "⠊", "⠑", "⠒", "⠔", "⠘"],  // 2 dots
  ["⠇", "⠋", "⠍", "⠓", "⠕", "⠙", "⠚", "⠜"],  // 3 dots
  ["⠏", "⠛", "⠝", "⠞", "⠧", "⠫", "⠭", "⠮"],  // 4 dots
  ["⠟", "⠯", "⠷", "⠻", "⠽", "⠾", "⡟", "⢟"],  // 5 dots
  ["⠿", "⡿", "⢿", "⣟", "⣯", "⣷", "⣻", "⣽"],  // 6 dots
  ["⣿", "⣾", "⣷", "⣯", "⣟"],                    // 7 dots
  ["⣿"],                                          // 8 dots (full)
];

function randomBraille(density: number): string {
  const chars = BRAILLE_BY_DENSITY[Math.min(density, 8)] || BRAILLE_BY_DENSITY[0];
  return chars[Math.floor(Math.random() * chars.length)];
}

/** Easing function for smooth density transitions */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

interface LoadingAnimationProps {
  color?: string;
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  color = "cyan",
}) => {
  const [frame, setFrame] = useState("");

  useEffect(() => {
    let tick = 0;
    const interval = setInterval(() => {
      tick++;
      // Cycle through densities with easing
      const cycle = (tick % 20) / 20; // 0 to 1 over 20 ticks
      const density = Math.round(easeInOut(cycle) * 8);

      // Generate 3-character frame
      const f = randomBraille(density) + randomBraille(Math.max(0, density - 1)) + randomBraille(Math.max(0, density - 2));
      setFrame(f);
    }, 120);

    return () => clearInterval(interval);
  }, []);

  return <Text color={color}>{frame || "⠀⠀⠀"}</Text>;
};
