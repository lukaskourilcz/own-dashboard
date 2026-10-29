// Spreadsheet text protection changes risky text cells; JSON preserves raw data.
// Quoting and a leading tab reduce formula execution in common spreadsheet
// imports, but are not a universal guarantee across spreadsheet applications.
function cell(value: unknown): string {
 let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
 if (typeof value === 'string' && /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@\uff1d\uff0b\uff0d\uff20]/u.test(text)) text = `\t${text}`;
 return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
 return [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n');
}
