/**
 * CSV cell escaping.
 *
 * Two separate jobs, and it is worth keeping them separate:
 *
 * 1. **Structural** escaping — a value containing a comma, quote or newline has
 *    to be wrapped in quotes so the row keeps its shape.
 * 2. **Formula neutralisation** — a spreadsheet treats a cell that *begins*
 *    with `=`, `+`, `-`, `@`, TAB or CR as a formula and evaluates it. A
 *    customer controls their own name, so an exported cell like
 *    `=cmd|'/c calc'!A1` would run when a staff member opens the export in
 *    Excel or Google Sheets. Prefixing with an apostrophe makes the
 *    spreadsheet show the text instead of evaluating it.
 *
 * A leading `-` is only dangerous when the cell is not a plain number, so
 * negative values keep working.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function isPlainNumber(text: string): boolean {
  // -1, 1.5, 1e3 are fine; -1+cmd() is not.
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text);
}

export function neutraliseFormula(value: string): string {
  if (!value) return value;
  if (!FORMULA_PREFIX.test(value)) return value;
  if (isPlainNumber(value)) return value;
  return `'${value}`;
}

/** Escape one CSV cell, ready to be joined with commas. */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = neutraliseFormula(raw);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Join already-escaped cells into one CSV line. */
export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}