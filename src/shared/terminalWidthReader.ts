// Reads the width of the terminal that hosts the status line. Claude Code pipes stdout, so
// process.stdout.columns is unset there; the controlling terminal still reports the real pane width.
export class TerminalWidthReader {
  private static readonly TTY_PATH = '/dev/tty';
  // Opening /dev/tty fails with ENXIO when the process has no controlling terminal.
  private static readonly NO_TTY_ERROR_CODE = 'ENXIO';
  private static readonly STTY_SIZE_ARGS = ['stty', 'size'];
  // stty prints "<rows> <cols>".
  private static readonly SIZE_PATTERN = /^\s*(\d+)\s+(\d+)\s*$/;

  // Returns the column count of the controlling terminal, or null when there is none.
  read(): number | null {
    try {
      const result = Bun.spawnSync(TerminalWidthReader.STTY_SIZE_ARGS, {
        stdin: Bun.file(TerminalWidthReader.TTY_PATH),
        stderr: 'ignore',
      });
      if (result.exitCode !== 0) {
        return null;
      }
      return this.parseSttySize(result.stdout.toString());
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === TerminalWidthReader.NO_TTY_ERROR_CODE) {
        return null;
      }
      throw err;
    }
  }

  parseSttySize(output: string): number | null {
    const match = TerminalWidthReader.SIZE_PATTERN.exec(output);
    if (!match) {
      return null;
    }
    const cols = Number(match[2]);
    return Number.isInteger(cols) && cols > 0 ? cols : null;
  }
}
