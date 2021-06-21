import _ from 'lodash';

import type {InnerType, TypesMap} from './types';

function pascalCase(str: string): string {
  const formatted = _.camelCase(str);
  return `${formatted[0].toUpperCase()}${formatted.substr(1)}`;
}

export class Converter {
  useEnums: boolean;
  types: TypesMap;
  usedTypes: Set<string>;
  namespace?: string;
  enums: Map<string, {key: string; value: string}[]>;

  constructor({types, namespace, useEnums}: {types: TypesMap; namespace?: string; useEnums?: boolean}) {
    this.useEnums = Boolean(useEnums);
    this.types = types;
    this.namespace = namespace;
    this.usedTypes = new Set();
    this.enums = new Map();

    for (const typeDecl of this.types.values()) {
      console.log(typeDecl.name);
      this.traverse(typeDecl.name, typeDecl.type, []);
    }
  }

  private traverse(name: string, type: InnerType, path: string[]) {
    switch (type.type) {
      case 'enum':
        let enumName = pascalCase(name);
        const values = type.values.map((value) => ({
          key: _.snakeCase(value).toUpperCase(),
          value,
        }));

        let pathIndex = path.length - 1;
        while (true) {
          const alreadyEnum = this.enums.get(enumName);

          if (alreadyEnum && alreadyEnum.join('|') !== values.join('|')) {
            if (pathIndex < 0) {
              throw new Error(`Top level enums duplicates: ${name}`);
            }

            enumName = pascalCase(`${path[pathIndex]}${enumName}`);
            pathIndex--;
          } else {
            break;
          }
        }

        type.enumName = enumName;

        this.enums.set(enumName, values);
        break;
      case 'object':
        for (const field of type.fields) {
          this.traverse(field.name, field.type, [...path, name]);
        }
        break;
    }
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
        if (this.useEnums && type.enumName) {
          this.usedTypes.add(type.enumName);
          return type.enumName;
        }

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

  private generateEnum(name: string, values: {key: string; value: string}[]): string {
    return `export enum ${name} {\n${values.map(({key, value}) => `  ${key} = '${value}',`).join('\n')}\n}`;
  }

  public extractEnums() {
    return [...this.enums.entries()].map(([name, values]) => this.generateEnum(name, values)).join('\n\n');
  }

  extractDefinitions(): string[] {
    const sortedTypes = [...this.types.values()].sort((info1, info2) => info1.name.localeCompare(info2.name));

    let typeDefinitions = sortedTypes.map((info) => `export type ${info.name} = ${this.toTs(info.type)};`);

    if (this.useEnums) {
      typeDefinitions = [...typeDefinitions, this.extractEnums()];
    }

    return typeDefinitions;
  }

  public getUsedTypeNames(): string[] {
    let enumNames: string[] = [];

    if (this.useEnums) {
      enumNames = [...this.enums.keys()].sort();
    }

    const typeNames = [...this.types.values()].map((n) => n.name).sort();

    return [...enumNames, ...typeNames].filter((name) => this.usedTypes.has(name));
  }
}
