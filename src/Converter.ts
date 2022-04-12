import _ from 'lodash';

import type {InnerType, ObjectType, RefType, TypeDeclaration, TypesMap} from './types';
import {EnumType, ObjectFieldType} from './types';

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

  private unrefType(type: RefType): TypeDeclaration {
    if (type.type !== 'ref') {
      throw new Error('Not a ref');
    }

    const actualType = this.types.get(type.ref);

    if (!actualType) {
      throw new Error(`Type "${type.ref}" is not found`);
    }

    return actualType;
  }

  private unref(type: TypeDeclaration | ObjectFieldType): TypeDeclaration | ObjectFieldType {
    if (type.type.type === 'ref') {
      return this.unrefType(type.type);
    }

    return type;
  }

  private getFieldTypeByName(type: InnerType, fieldName: string): TypeDeclaration | ObjectFieldType | undefined {
    switch (type.type) {
      case 'ref': {
        const typeByRef = this.types.get(type.ref);

        if (!typeByRef) {
          throw new Error('No type by ref');
        }

        return this.getFieldTypeByName(typeByRef.type, fieldName);
      }

      case 'object': {
        const foundField = type.fields.find(({name}) => name === fieldName);

        if (!foundField) {
          return undefined;
        }

        return this.unref(foundField);
      }

      case 'object-composition': {
        for (const innerType of [...type.composition].reverse()) {
          const type = this.getFieldTypeByName(innerType, fieldName);

          if (type) {
            return type;
          }
        }

        throw new Error('Field is not found');
      }

      default:
        console.warn(`Unknown type: ${type.type}`);
        throw new Error('Unknown type');
    }
  }

  toTs(type: InnerType, depth = 0, {readonly}: {readonly?: boolean} = {}): string {
    const gap = '  '.repeat(depth);
    const innerGap = '  '.repeat(depth + 1);
    const modificators = `${readonly ? 'readonly ' : ''}`;

    switch (type.type) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'void':
        return type.type;
      case 'object':
        return `${modificators}{
${innerGap}${type.fields
          .map((field) => {
            return `${field.name}${field.required ? '' : '?'}: ${this.toTs(field.type, depth + 1)}`;
          })
          .join(`;\n${innerGap}`)};
${gap}}`;

      case 'object-composition':
        return type.composition.map((type) => this.toTs(type, depth)).join(' & ');

      case 'union':
        const propertyName = type.discriminator.propertyName;
        const mapping = type?.discriminator?.mapping ? [...Object.entries(type.discriminator.mapping)] : undefined;

        const variants = type.union
          .map((innerType) => {
            const serializedType = this.toTs(innerType, depth);

            if (mapping) {
              if (innerType.type !== 'ref') {
                throw new Error('No ref type with mapping');
              }

              const propertyValueEntry = mapping.find(([, ref]) => ref === innerType.ref);

              if (!propertyValueEntry) {
                throw new Error('Mapping ref type is not matched');
              }

              const propertyValue = propertyValueEntry[0];
              let value: string | undefined;

              if (this.useEnums) {
                let discriminatorType;

                if (type.discriminatorType) {
                  discriminatorType = this.unrefType(type.discriminatorType);
                } else {
                  const finalType = this.types.get(innerType.ref)!;
                  discriminatorType = this.getFieldTypeByName(finalType.type, propertyName);
                }

                if (discriminatorType && discriminatorType.type.type === 'enum') {
                  if (!discriminatorType.type.values.some((value) => value === propertyValue)) {
                    throw new Error('No enum value');
                  }

                  value = `${discriminatorType.name}.${propertyValue}`;
                }
              }

              if (!value) {
                value = `"${propertyValue}"`;
              }

              return `Omit<${serializedType}, '${propertyName}'> & { ${propertyName}: ${value} }`;
            }

            return serializedType;
          })
          .join(' | ');

        let fields: ObjectType | undefined;

        if (type.fieldsObject) {
          fields = {
            ...type.fieldsObject,
            fields: type.fieldsObject.fields.filter((field) => field.name !== propertyName),
          };
        }

        if (fields) {
          return `${this.toTs(fields, depth)} & (${variants})`;
        }

        return `(${variants})`;

      case 'map': {
        const mapType = `Record<string, ${this.toTs(type.elementType, depth)}>`;

        if (readonly) {
          return `Readonly<${mapType}>`;
        }

        return mapType;
      }

      case 'free-form-map':
        if (readonly) {
          return 'Readonly<Record<string, unknown>>';
        }

        return 'Record<string, unknown>';

      case 'array':
        return `${modificators}${this.toTs(type.elementType, depth)}[]`;

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
        // @ts-ignore
        console.warn(`Can't process unknown type: ${type.type}, using "never" instead.`);
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
