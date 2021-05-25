import {promises as fs} from 'fs';

import type {ApiMethod} from './index';
import type {InnerType, TypeDeclaration} from './types';
import {Parameter} from './types';
import {capitalize} from './utils';

type TypesMap = Map<string, TypeDeclaration>;

type Data = {
  apiMethods: ApiMethod[];
  types: TypeDeclaration[];
};

const apiGroupCode = `/* eslint-disable @typescript-eslint/no-explicit-any */

export type Methods = 'GET' | 'POST' | 'PUT' | 'PATCH';

class ApiGroup {
  public readonly method: Methods;

  private readonly middleware: any;

  public constructor(method: Methods, middleware: any) {
    this.method = method;
    this.middleware = middleware;
  }

  protected callApi(routePath: string, params: any): Promise<any> {
    return this.middleware(this.method, routePath, params);
  }
}
`;

const apiServiceCode = `
export class ApiService {
  public readonly get = new ApiGroupGet(this.middleware);

  public readonly post = new ApiGroupPost(this.middleware);

  public readonly put = new ApiGroupPut(this.middleware);

  public readonly patch = new ApiGroupPatch(this.middleware);

  private middleware = any;

  constructor(middleware: any) {
    this.middleware = middleware;
  }
}
`;

function convertToTs(types: TypesMap, type: InnerType, depth = 0): string {
  // console.log('type:', type);

  const gap = '  '.repeat(depth);
  const innerGap = '  '.repeat(depth + 1);

  switch (type.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return type.type;
    case 'object':
      return `{
${innerGap}${type.fields
        .map((field) => {
          return `${field.name}${field.required ? '' : '?'}: ${convertToTs(types, field.type, depth + 1)}`;
        })
        .join(`;\n${innerGap}`)};
${gap}}`;

    case 'object-composition':
      return type.composition.map((type) => convertToTs(types, type, depth + 1)).join(' & ');

    case 'map':
      return `Record<string, ${convertToTs(types, type.elementType, depth)}>`;

    case 'array':
      return `${convertToTs(types, type.elementType, depth)}[]`;

    case 'ref': {
      const typeDecl = types.get(type.ref);

      if (!typeDecl) {
        throw new Error(`Type "${type.ref}" has not found`);
      }

      return typeDecl.name;
    }

    default:
      return 'never';
  }
}

async function processTypes(types: TypesMap) {
  const sorted = [...types.values()].sort((info1, info2) => info1.name.localeCompare(info2.name));

  const typeDefinitions = sorted.map((info) => {
    return `export type ${info.name} = ${convertToTs(types, info.type)};
`;
  });

  await fs.writeFile('out/types.ts', typeDefinitions.join('\n') + '\n');
}

type ApiDecl = {
  routePath: string;
  params: Parameter[];
  flat: InnerType[];
};

async function processApi(types: TypesMap, apiMethods: ApiMethod[]) {
  const methodGrouped: Record<string, ApiDecl[]> = {
    get: [],
    post: [],
    put: [],
    patch: [],
  };

  for (const {method, routePath, params} of apiMethods) {
    methodGrouped[method.toLowerCase()].push({
      routePath,
      params: params.parameters,
      flat: params.flatTypes,
    });
  }

  const filteredMethods = Object.entries(methodGrouped);

  await fs.writeFile(
    'out/api.ts',
    apiGroupCode +
      '\n' +
      filteredMethods
        .map(([methodName, list]) => {
          const methods = list.map(
            ({routePath, params}) => `public async '${routePath}'(params: {
    ${params.map((p) => `${p.name}${p.required ? '' : '?'}: ${convertToTs(types, p.type)}`).join(',\n    ')}
  }): ${'Promise<string>'} {
    return this.callApi("${routePath}", params);
  }`,
          );

          return `class ApiGroup${capitalize(methodName)} extends ApiGroup {
  public constructor(middleware: any) {
    super("${methodName.toUpperCase()}", middleware);
  }

  ${methods.join('\n\n  ')}
}\n`;
        })
        .join('\n') +
      `\n${apiServiceCode}`,
  );
}

export async function generate({types, apiMethods}: Data) {
  console.log(apiMethods);
  console.log(types);
  console.log('Done');

  const typesMap = new Map(types.map((type) => [type.fullName, type]));

  await processTypes(typesMap);
  await processApi(typesMap, apiMethods);
}
