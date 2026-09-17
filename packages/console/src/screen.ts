/** Repaint changed rows only; streaming an orb must not redraw the transcript. */
export class TerminalScreen {
  private rows: string[] = [];
  private columns = 0;
  private position = "";
  paint(
    frame: string,
    columns: number,
    cursor?: { row: number; column: number },
  ) {
    const next = frame.split("\r\n");
    const resize = columns !== this.columns || next.length !== this.rows.length;
    let output = resize ? "\x1b[2J" : "";
    for (let row = 0; row < next.length; row++)
      if (resize || this.rows[row] !== next[row])
        output += `\x1b[${row + 1};1H${next[row]}`;
    this.rows = next;
    this.columns = columns;
    const position = cursor
      ? `\x1b[${cursor.row};${cursor.column}H\x1b[?25h`
      : "\x1b[?25l";
    const moved = position !== this.position;
    this.position = position;
    return output
      ? `${cursor ? "\x1b[?25l" : ""}${output}${cursor || moved ? position : ""}`
      : moved
        ? position
        : "";
  }
}
