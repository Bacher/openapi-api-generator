import {promises as fs} from 'fs';

import type {ApiMethod, InnerType, TypeDeclaration} from './types';
import {ParameterPlace} from './types';
import {capitalize} from './utils';

type TypesMap = Map<string, TypeDeclaration>;

type Data = {
  apiMethods: ApiMethod[];
  types: Map<string, TypeDeclaration>;
};

const apiGroupCode = `/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  %IMPORTS%
} from './types';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

export type QueryParams = Record<string, string | number | undefined>;

export type MiddlewareParams = {
  method: Method;
  route: string;
  query?: QueryParams;
  body?: any;
}

export type Middleware = (params: MiddlewareParams) => Promise<any>;

function interpolateParams(url: string, params: QueryParams) {
  let updatedUrl = url;
  
  while (true) {
    const match = updatedUrl.match(/{([A-Za-z_][A-Za-z0-9_]*)}/);
    
    if (!match) {
      break;
    }
    
    const value = params[match[1]] ?? '';
    
    updatedUrl = \`\${updatedUrl.substr(0, match.index)}\${value}\${updatedUrl.substr((match.index || 0) + match[0].length)}\` 
  }
  
  return updatedUrl;
}

class ApiGroup {
  public readonly method: Method;

  private readonly middleware: Middleware;

  public constructor(method: Method, middleware: Middleware) {
    this.method = method;
    this.middleware = middleware;
  }

  protected callApi(route: string, query?: QueryParams, body?: any): Promise<any> {
    return this.middleware({
      method: this.method,
      route,
      query,
      body,
    });
  }
}
`;

const apiServiceCode = `
export class ApiService {
  public readonly get: ApiGroupGet;
  public readonly post: ApiGroupPost;
  public readonly put: ApiGroupPut;
  public readonly patch: ApiGroupPatch;

  constructor(middleware: Middleware) {
    this.get = new ApiGroupGet(middleware);
    this.post = new ApiGroupPost(middleware);
    this.put = new ApiGroupPut(middleware);
    this.patch = new ApiGroupPatch(middleware);
  }
}
`;

function convertToTs(types: TypesMap, usedTypes: Set<string> | undefined, type: InnerType, depth = 0): string {
  // console.log('type:', type);

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
          return `${field.name}${field.required ? '' : '?'}: ${convertToTs(types, usedTypes, field.type, depth + 1)}`;
        })
        .join(`;\n${innerGap}`)};
${gap}}`;

    case 'object-composition':
      return type.composition.map((type) => convertToTs(types, usedTypes, type, depth + 1)).join(' & ');

    case 'map':
      return `Record<string, ${convertToTs(types, usedTypes, type.elementType, depth)}>`;

    case 'array':
      return `${convertToTs(types, usedTypes, type.elementType, depth)}[]`;

    case 'ref': {
      const typeDecl = types.get(type.ref);

      if (!typeDecl) {
        throw new Error(`Type "${type.ref}" has not found`);
      }

      if (usedTypes) {
        usedTypes.add(typeDecl.name);
      }

      return typeDecl.name;
    }

    default:
      return 'never';
  }
}

function sortTypes(types: Map<string, TypeDeclaration>): TypeDeclaration[] {
  return [...types.values()].sort((info1, info2) => info1.name.localeCompare(info2.name));
}

async function processTypes(types: TypesMap) {
  const typeDefinitions = sortTypes(types).map((info) => {
    return `export type ${info.name} = ${convertToTs(types, undefined, info.type)};
`;
  });

  await fs.writeFile('out/types.ts', typeDefinitions.join('\n') + '\n');
}

function formatMethod(
  types: TypesMap,
  usedTypes: Set<string>,
  {routePath, params: {parameters, flatTypes}, resultType}: ApiMethod,
): string {
  const inPathParams = parameters.filter((param) => param.place == ParameterPlace.IN_PATH).map((param) => param.name);
  const inQueryParams = parameters.filter((param) => param.place == ParameterPlace.QUERY).map((param) => param.name);
  const extractParams = [...inPathParams, ...inQueryParams];

  let paramsType = parameters.length
    ? `{ ${parameters
        .map((p) => `${p.name}${p.required ? '' : '?'}: ${convertToTs(types, usedTypes, p.type)}`)
        .join(',\n    ')} }`
    : '';

  if (flatTypes.length) {
    paramsType += `${paramsType ? ' & ' : ''}${flatTypes
      .map((type) => convertToTs(types, usedTypes, type))
      .join(' & ')}`;
  }

  let bodyCode = '';
  let queryParams = 'undefined';
  let routeCode = `'${routePath}'`;

  if (flatTypes.length > 0 || parameters.length - inPathParams.length - inQueryParams.length > 0) {
    bodyCode = 'body';
  }

  let paramsCode: string;

  if (extractParams.length) {
    paramsCode = `{ ${extractParams.join(', ')}${bodyCode ? `, ...${bodyCode}` : ''} }`;

    if (inPathParams) {
      routeCode = `interpolateParams('${routePath}', { ${inPathParams.join(', ')} })`;
    }

    if (inQueryParams.length) {
      queryParams = `{ ${inQueryParams.join(', ')} }`;
    }
  } else {
    paramsCode = `${bodyCode}`;
  }

  return `public async '${routePath}'(${paramsCode ? `${paramsCode}: ${paramsType}` : ''}): Promise<${convertToTs(
    types,
    usedTypes,
    resultType,
    1,
  )}> {
    return this.callApi(${routeCode}, ${queryParams}${bodyCode ? `, ${bodyCode}` : ''});
  }`;
}

async function processApi(types: TypesMap, apiMethods: ApiMethod[]) {
  const methodGrouped: Record<string, ApiMethod[]> = {
    get: [],
    post: [],
    put: [],
    patch: [],
  };

  for (const apiMethod of apiMethods) {
    methodGrouped[apiMethod.method.toLowerCase()].push(apiMethod);
  }

  const usedTypes = new Set<string>();

  const methodsPart = Object.entries(methodGrouped)
    .map(([methodName, list]) => {
      const methods = list.map((m) => formatMethod(types, usedTypes, m));

      return `class ApiGroup${capitalize(methodName)} extends ApiGroup {
  public constructor(middleware: Middleware) {
    super("${methodName.toUpperCase()}", middleware);
  }

  ${methods.join('\n\n  ')}
}\n`;
    })
    .join('\n');

  const head = apiGroupCode.replace(
    '%IMPORTS%',
    sortTypes(types)
      .filter((type) => usedTypes.has(type.name))
      .map((type) => type.name)
      .join(',\n  '),
  );

  const apiCode = `${head}
${methodsPart}
${apiServiceCode}`;

  await fs.writeFile('out/api.ts', apiCode);
}

export async function generate({types, apiMethods}: Data) {
  await processTypes(types);
  await processApi(types, apiMethods);

  console.info(`Success (files have been generated):
  * out/types.ts
  * out/api.ts`);
}
