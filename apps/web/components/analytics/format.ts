/** Exact decimal labels. Number conversion is reserved for SVG geometry. */
export function formatDecimal(value: string | null, unit?: string) {
  if (value === null) return 'N/A';
  const [integer, fraction = ''] = value.split('.');
  const grouped = BigInt(integer!).toLocaleString('en-US');
  const tail = fraction.replace(/0+$/, '');
  return `${value.startsWith('-') && BigInt(integer!) === 0n ? '-' : ''}${grouped}${tail ? '.' + tail : ''}${unit ? ' ' + unit : ''}`;
}
