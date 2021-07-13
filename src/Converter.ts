import _ from 'lodash';

import type {InnerType, TypesMap} from './types';
import {EnumType} from './types';

function pascalCase(str: string): string {
  const formatted = _.camelCase(str);
  return `${formatted[0].toUpperCase()}${formatted.substr(1)}`;
}

function upperSnakeCase(str: string): string {
  return _.snakeCase(str).toUpperCase();
}

type EnumValues = {key: string; value: string}[];

function enumFootprint(enumValues: EnumValues) {
  return [...enumValues]
    .sort((v1, v2) => v1.value.localeCompare(v2.value))
    .map((v) => v.value)
    .join('|');
}

function compareEnums(enum1: EnumValues, enum2: EnumValues): boolean {
  return enumFootprint(enum1) === enumFootprint(enum2);
}

function fulfillEnumValues(values: string[]) {
  return values.map((value) => ({
    key: upperSnakeCase(value),
    value,
  }));
}

export class Converter {
  useEnums: boolean;
  types: TypesMap;
  usedTypes: Set<string>;
  namespace?: string;
  inlineEnums: Map<string, {key: string; value: string}[]>;

  constructor({types, namespace, useEnums}: {types: TypesMap; namespace?: string; useEnums?: boolean}) {
    this.useEnums = Boolean(useEnums);
    this.types = types;
    this.namespace = namespace;
    this.usedTypes = new Set();
    this.inlineEnums = new Map();

    const duplicates = new Set<string>();
    while (true) {
      const duplicatesCount = duplicates.size;

      for (const typeDecl of this.types.values()) {
        this.traverse(typeDecl.name, typeDecl.type, [], duplicates);
      }

      if (duplicatesCount === duplicates.size) {
        break;
      }
    }
  }

  private traverse(name: string, type: InnerType, path: string[], duplicates: Set<string>) {
    switch (type.type) {
      case 'enum':
        let extractedEnumName = pascalCase(name);
        const values = fulfillEnumValues(type.values);

        const globalEnum = [...this.types.values()].find((t) => t.type.type === 'enum' && t.name === extractedEnumName);

        if (globalEnum) {
          this.usedTypes.has(globalEnum.name);
          break;
        }

        let pathIndex = path.length - 1;
        while (true) {
          let isDuplicate = false;

          if ([...this.types.values()].some((t) => t.name === extractedEnumName)) {
            isDuplicate = true;
          } else if (duplicates.has(extractedEnumName)) {
            isDuplicate = true;
          } else {
            const alreadyEnum = this.inlineEnums.get(extractedEnumName);

            if (alreadyEnum && !compareEnums(alreadyEnum, values)) {
              isDuplicate = true;
              this.inlineEnums.delete(extractedEnumName);
              duplicates.add(extractedEnumName);
            }
          }

          if (isDuplicate || extractedEnumName.length < 3 || extractedEnumName === 'Type') {
            if (pathIndex < 0) {
              throw new Error(`Top level enums duplicates: ${name}`);
            }

            extractedEnumName = pascalCase(`${path[pathIndex]}${extractedEnumName}`);
            pathIndex--;
          } else {
            break;
          }
        }

        type.extractedEnumName = extractedEnumName;

        this.inlineEnums.set(extractedEnumName, values);
        break;
      case 'object':
        for (const field of type.fields) {
          this.traverse(field.name, field.type, [...path, name], duplicates);
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
        if (this.useEnums && type.extractedEnumName) {
          this.usedTypes.add(type.extractedEnumName);
          return type.extractedEnumName;
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

  extractDefinitions(): string[] {
    const sortedTypes = [...this.types.values()].sort((info1, info2) => info1.name.localeCompare(info2.name));

    let realTypes = sortedTypes;
    let enumDeclarations: string[] = [];

    if (this.useEnums) {
      realTypes = sortedTypes.filter((info) => info.type.type !== 'enum');

      const inlineEnums = [...this.inlineEnums.entries()].map(([name, values]) => ({name, values}));

      const topLevelEnums = sortedTypes
        .filter((info) => info.type.type === 'enum')
        .map(({name, type}) => ({
          name,
          values: fulfillEnumValues((type as EnumType).values),
        }));

      enumDeclarations = [...inlineEnums, ...topLevelEnums]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({name, values}) => this.generateEnum(name, values));
    }

    const types = realTypes.map((info) => `export type ${info.name} = ${this.toTs(info.type)};`);

    return [...enumDeclarations, ...types];
  }

  public getUsedTypeNames(): string[] {
    let enumNames: string[] = [];

    if (this.useEnums) {
      enumNames = [...this.inlineEnums.keys()].sort();
    }

    const typeNames = [...this.types.values()].map((n) => n.name).sort();

    return [...enumNames, ...typeNames].filter((name) => this.usedTypes.has(name));
  }
}
