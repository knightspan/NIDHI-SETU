import { BadRequestException, type PipeTransform, applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/** Validates and transforms a request part with a shared zod schema (Rule 6: validate every input). */
export class ZodPipe<T extends ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

function jsonSchema(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
  } catch {
    return { type: 'object' };
  }
}

/** Documents a zod request body in OpenAPI. */
export function ApiZodBody(schema: ZodType): MethodDecorator {
  return applyDecorators(ApiBody({ schema: jsonSchema(schema) }));
}

/** Documents zod query parameters in OpenAPI (one entry per top-level key). */
export function ApiZodQuery(schema: ZodType): MethodDecorator {
  const js = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>> };
  const decorators = Object.entries(js.properties ?? {}).map(([name, prop]) =>
    ApiQuery({ name, required: false, schema: prop }),
  );
  return applyDecorators(...decorators);
}
