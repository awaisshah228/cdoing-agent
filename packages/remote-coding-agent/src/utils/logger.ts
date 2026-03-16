/**
 * Structured logger with level filtering and channel tagging.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

export class Logger {
  private level: number;

  constructor(
    private prefix: string,
    level: string = "info",
  ) {
    this.level = LEVELS[level as LogLevel] ?? LEVELS.info;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.level <= LEVELS.debug) this.log("DEBUG", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.level <= LEVELS.info) this.log("INFO", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.level <= LEVELS.warn) this.log("WARN", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.level <= LEVELS.error) this.log("ERROR", message, data);
  }

  /** Create a child logger with an appended prefix. */
  child(subPrefix: string): Logger {
    const child = new Logger(`${this.prefix}:${subPrefix}`);
    child.level = this.level;
    return child;
  }

  private log(level: string, message: string, data?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [${this.prefix}] ${message}`;
    if (data) {
      console.log(line, JSON.stringify(data));
    } else {
      console.log(line);
    }
  }
}
