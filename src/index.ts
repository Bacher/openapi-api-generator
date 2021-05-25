/* eslint-disable no-await-in-loop */
import {promises as fs} from 'fs';
import path from 'path';
import {parse} from 'yaml';

import {InnerType, RefType, ObjectFieldType, Parameter, ParameterPlace, TypeDeclaration} from './types';
import type {Paths, YamlType, YamlFile} from './yaml.types';

import {generate} from './generator';

const entryFile = process.argv.slice(2).pop()!;

if (!entryFile) {
  console.error('Need to specify openapi file');
  process.exit(1);
}

export type ApiMethod = {
  routePath: string;
  method: string;
  params: {
    parameters: Parameter[];
    flatTypes: InnerType[];
  };
};

const loadFiles = new Set<string>();
const loadedFiles = new Set<string>();
const types = new Map<string, TypeDeclaration>();
const notLoadedTypes = new Set<string>();
const apiMethods: ApiMethod[] = [];

function normalizeName(name: string) {
  return name.replace(/[.,!@#$%^&*()_-]+/g, '');
}

function loadTypes(typePath: string, fileName: string): RefType {
  const [file, fullTypeName] = typePath.trim().split('#');

  if (!fullTypeName.startsWith('/components/schemas/')) {
    throw new Error(`Invalid ref link: "${fullTypeName}"`);
  }

  const normFileName = file || fileName;

  const normTypePath = `${normFileName}#${fullTypeName}`;

  if (!types.get(normTypePath)) {
    if (normFileName && !loadedFiles.has(normFileName)) {
      loadFiles.add(normFileName);
    }

    notLoadedTypes.add(normTypePath);
  }

  return {
    type: 'ref',
    ref: normTypePath,
  };
}

function convertType(propType: YamlType, file: string): InnerType {
  if ('$ref' in propType) {
    return loadTypes(propType['$ref'], file);
  }

  if (!propType.type && 'properties' in propType) {
    // eslint-disable-next-line no-param-reassign
    propType.type = 'object';
  }

  switch (propType.type) {
    case 'boolean':
    case 'string':
    case 'number':
      return {
        type: propType.type,
      };
    case 'integer':
      return {
        type: 'number',
      };
    case 'array': {
      const {items} = propType;

      if (!items) {
        throw new Error('Array without items specification');
      }

      return {
        type: 'array',
        elementType: convertType(items, file),
      };
    }
    case 'object': {
      const fields: ObjectFieldType[] = [];

      if ('allOf' in propType) {
        return {
          type: 'object-composition',
          // @ts-ignore
          composition: propType.allOf.map((part) => convertType(part, file)),
        };
      } else if ('properties' in propType) {
        for (const [fieldName, fieldDesc] of Object.entries(propType.properties)) {
          fields.push({
            name: normalizeName(fieldName),
            type: convertType(fieldDesc, file),
            required: propType.required?.includes(fieldName) || false,
          });
        }

        return {
          type: 'object',
          fields,
        };
      } else if ('additionalProperties' in propType) {
        return {
          type: 'map',
          elementType: convertType(propType.additionalProperties, file),
        };
      } else {
        console.error('Invalid object:', propType);
        throw new Error('Invalid object notation');
      }
    }
    default:
      // @ts-ignore
      throw new Error(`Unknown field type: "${propType.type}"`);
  }
}

function fitModels(data: YamlFile, file: string) {
  for (const [schemaName, schema] of Object.entries(data.components.schemas)) {
    const fullModelName = `${file}#/components/schemas/${schemaName}`;

    types.set(fullModelName, {
      name: normalizeName(schemaName),
      fullName: fullModelName,
      type: convertType(schema, file),
    });
    notLoadedTypes.delete(fullModelName);
  }
}

async function parseFile(fileName: string) {
  const realFileName = path.join(path.dirname(entryFile), fileName);

  const data = await fs.readFile(realFileName, 'utf-8');

  fitModels(parse(data), fileName);
}

async function recursiveLoad() {
  while (loadFiles.size) {
    for (const file of loadFiles) {
      await parseFile(file);
      loadFiles.delete(file);
      // eslint-disable-next-line no-continue
      continue;
    }
  }

  for (const loadingType of notLoadedTypes) {
    throw new Error(`Schema "${loadingType}" can't be loaded`);
  }
}

async function run() {
  const api = await fs.readFile(entryFile, 'utf-8');

  const parsed = parse(api);

  fitModels(parsed, '');

  for (const [routePath, desc] of Object.entries<Paths>(parsed.paths)) {
    for (const [originalMethod, info] of Object.entries(desc)) {
      const method = originalMethod.toUpperCase();

      const parameters: Parameter[] = [];
      const flatTypes: InnerType[] = [];

      if (info.parameters) {
        for (const {in: place, name, required} of info.parameters) {
          if (place === 'path') {
            if (!required) {
              throw new Error(`Non-required parameter "${name}" in path: "${routePath}"`);
            }

            parameters.push({
              place: ParameterPlace.IN_PATH,
              name: normalizeName(name),
              type: {type: 'string'},
              required: true,
            });
          } else if (place === 'query') {
            parameters.push({
              place: ParameterPlace.QUERY,
              name: normalizeName(name),
              type: {type: 'string'},
              required: true,
            });
          } else {
            throw new Error(`Invalid 'in' value: "${place}"`);
          }
        }
      }

      if (info.requestBody) {
        const body = info.requestBody.content['application/json'];

        if (!body?.schema) {
          throw new Error(`Body without data in api: "${routePath}"`);
        }

        const final = convertType(body.schema, '');

        if (final.type === 'object') {
          for (const field of final.fields) {
            parameters.push({
              place: ParameterPlace.BODY,
              name: field.name,
              type: field.type,
              required: field.required,
            });
          }
        } else {
          flatTypes.push(final);
        }
      }

      apiMethods.push({
        method,
        routePath,
        params: {
          parameters,
          flatTypes,
        },
      });
    }
  }

  await recursiveLoad();

  const typesList = [...types.values()];

  if (types.size !== new Set(typesList.map((type) => type.name)).size) {
    throw new Error('Duplicate class has found');
  }

  await generate({types: typesList, apiMethods});
}

run().catch((err) => {
  console.error('Fatal Error');
  console.error(err);
  process.exit(1);
});
