import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
export function decodeCursor(value?: string): { id: string; at: Date } | null {
  if (!value) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      !('id' in data) ||
      typeof data.id !== 'string' ||
      !isUUID(data.id) ||
      !('at' in data) ||
      typeof data.at !== 'string' ||
      !Number.isFinite(Date.parse(data.at))
    )
      throw new Error();
    return { id: data.id, at: new Date(data.at) };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
export function encodeCursor(row: { id: string; createdAt: Date }) {
  return Buffer.from(JSON.stringify({ id: row.id, at: row.createdAt.toISOString() })).toString(
    'base64url',
  );
}
export function filterDate(value?: string) {
  if (!value) return undefined;
  return new Date(
    value.includes('T') && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value,
  );
}
