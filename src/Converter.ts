import type {InnerType, TypesMap} from './types';

export class Converter {
  types: TypesMap;
  usedTypes: Set<string>;
  namespace?: string;

  constructor({types, namespace}: {types: TypesMap; namespace?: string}) {
    this.types = types;
    this.namespace = namespace;
    this.usedTypes = new Set();
  }

  toTs(type: InnerType, depth = 0): string {
    const gap = '  '.repeat(depth);
    const innerGap = '  '.repeat(depth + 1);

    switch (type.type) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'void':
        return type.type;
      case 'object':
        return `{
${innerGap}${type.fields
          .map((field) => {
            return `${field.name}${field.required ? '' : '?'}: ${this.toTs(field.type, depth + 1)}`;
          })
          .join(`;\n${innerGap}`)};
${gap}}`;

      case 'object-composition':
        return type.composition.map((type) => this.toTs(type, depth)).join(' & ');

      case 'map':
        return `Record<string, ${this.toTs(type.elementType, depth)}>`;

      case 'array':
        return `${this.toTs(type.elementType, depth)}[]`;

      case 'enum':
        return type.values.map((value) => `'${value}'`).join(' | ');

      case 'ref': {
        const typeDecl = this.types.get(type.ref);

        if (!typeDecl) {
          throw new Error(`Type "${type.ref}" has not found`);
        }

        this.usedTypes.add(typeDecl.name);

        return `${this.namespace ? `${this.namespace}.` : ''}${typeDecl.name}`;
      }

      default:
        return 'never';
    }
  }
}
