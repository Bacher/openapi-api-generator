import {
  ApiMethod,
  InnerType,
  ObjectFieldType,
  ObjectType,
  Parameter,
  ParameterPlace,
  RefType,
  TypeDeclaration,
} from './types';
import {Paths, YamlFile, YamlType} from './yaml.types';
import path from 'path';
import {promises as fs} from 'fs';
import {parse} from 'yaml';

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

  if (!propType.type && ('properties' in propType || 'additionalProperties' in propType)) {
    // eslint-disable-next-line no-param-reassign
    propType.type = 'object';
  }

  switch (propType.type) {
    case 'boolean':
    case 'number':
      return {
        type: propType.type,
      };
    case 'string':
      if (propType.enum) {
        return {
          type: 'enum',
          values: propType.enum,
        };
      }
      return {
        type: 'string',
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
      let propertiesObject: ObjectType | undefined;

      if ('properties' in propType && propType.properties) {
        const fields: ObjectFieldType[] = [];
        for (const [fieldName, fieldDesc] of Object.entries(propType.properties)) {
          fields.push({
            name: normalizeName(fieldName),
            type: convertType(fieldDesc, file),
            required: propType.required?.includes(fieldName) || false,
          });
        }

        propertiesObject = {
          type: 'object',
          fields,
        };
      }

      if ('allOf' in propType) {
        const composition = propType.allOf.map((part) => convertType(part, file));

        if (propertiesObject) {
          composition.push(propertiesObject);
        }

        return {
          type: 'object-composition',
          // @ts-ignore
          composition,
        };
      } else if ('oneOf' in propType) {
        let discriminatorType;

        if (propertiesObject) {
          const discriminatorField = propertiesObject.fields.find(
            ({name}) => name === propType.discriminator.propertyName,
          );

          if (discriminatorField) {
            // TODO: Add inline enums
            // if (discriminatorField.type.type === 'ref' || discriminatorField.type.type === 'enum') {
            if (discriminatorField.type.type === 'ref') {
              discriminatorType = discriminatorField.type;
            }
          }
        }

        return {
          type: 'union',
          fieldsObject: propertiesObject,
          // @ts-ignore
          union: propType.oneOf.map((part) => convertType(part, file)),
          discriminator: propType.discriminator,
          discriminatorType,
        };
      } else if (propertiesObject) {
        return propertiesObject;
      } else if ('additionalProperties' in propType) {
        if (propType.additionalProperties === true) {
          return {
            type: 'free-form-map',
          };
        }

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

async function parseFile({dirName, fileName}: {dirName: string; fileName: string}) {
  const realFileName = path.join(dirName, fileName);

  const data = await fs.readFile(realFileName, 'utf-8');

  fitModels(parse(data), fileName);
}

async function recursiveLoad(dirName: string) {
  while (loadFiles.size) {
    for (const fileName of loadFiles) {
      await parseFile({dirName, fileName});
      loadFiles.delete(fileName);
      // eslint-disable-next-line no-continue
      continue;
    }
  }

  for (const loadingType of notLoadedTypes) {
    throw new Error(`Schema "${loadingType}" can't be loaded`);
  }
}

function extractPathParams(path: string): string[] {
  const params = [];
  let updated = path;

  while (true) {
    const match = updated.match(/{([A-Za-z_][A-Za-z0-9_]*)}/);

    if (!match) {
      break;
    }

    params.push(match[1]);

    const index = match.index || 0;

    updated = `${updated.substr(0, index)}${updated.substr(index + match[0].length)}`;
  }

  if (/[{}]/.test(updated)) {
    throw new Error('Url have invalid parameter syntax');
  }

  return params;
}

export async function parseOpenapi(entryFile: string) {
  const api = await fs.readFile(entryFile, 'utf-8');

  const parsed = parse(api);

  fitModels(parsed, '');

  for (const [routePath, desc] of Object.entries<Paths>(parsed.paths)) {
    const pathParams = new Set(extractPathParams(routePath));

    for (const [originalMethod, info] of Object.entries(desc)) {
      const method = originalMethod.toUpperCase();

      const parameters: Parameter[] = [];
      const flatTypes: InnerType[] = [];
      let resultType: InnerType = {type: 'void'};

      if (info.parameters) {
        for (const {in: place, name, required} of info.parameters) {
          if (place === 'path') {
            if (!required) {
              throw new Error(`Non-required parameter "${name}" in path: "${routePath}"`);
            }

            if (!pathParams.has(name)) {
              throw new Error(`Api path doesn't contain parameter {${name}}`);
            }

            pathParams.delete(name);

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
              required: Boolean(required),
            });
          } else {
            throw new Error(`Invalid 'in' value: "${place}"`);
          }
        }
      }

      if (pathParams.size) {
        throw new Error(`Not all path parameters described: "${[...pathParams.keys()].join(', ')}"`);
      }

      if (info.requestBody) {
        if (method === 'GET') {
          throw new Error('Requested body in GET request');
        }

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

      if (info.responses) {
        const successResponse = info.responses?.['200'];

        if (!successResponse) {
          throw new Error('Api without success result');
        }

        const schema = successResponse?.content?.['application/json']?.schema;

        if (schema) {
          resultType = convertType(schema, '');
        }
      }

      apiMethods.push({
        method,
        routePath,
        params: {
          parameters,
          flatTypes,
        },
        resultType,
      });
    }
  }

  await recursiveLoad(path.dirname(entryFile));

  const typesList = [...types.values()];

  if (types.size !== new Set(typesList.map((type) => type.name)).size) {
    throw new Error('Duplicate class has found');
  }

  return {
    types,
    apiMethods,
  };
}
