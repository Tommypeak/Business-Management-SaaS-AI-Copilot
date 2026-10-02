import { ParseUUIDPipe, type ArgumentMetadata } from '@nestjs/common';
/** PostgreSQL UUID equality and advisory lock/hash identity must agree. */
export class CanonicalUuidPipe extends ParseUUIDPipe {
  override async transform(value: string, metadata: ArgumentMetadata): Promise<string> {
    return (await super.transform(value, metadata)).toLowerCase();
  }
}
