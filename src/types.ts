export enum ParameterPlace {
  IN_PATH = 'IN_PATH',
  QUERY = 'QUERY',
  BODY = 'BODY',
}

export type StringType = {
  type: 'string';
};

export type NumberType = {
  type: 'number';
};

export type BooleanType = {
  type: 'boolean';
};

export type ObjectFieldType = {
  name: string;
  type: InnerType;
  required: boolean;
};

export type ObjectType = {
  type: 'object';
  fields: ObjectFieldType[];
};

export type ObjectCompositionType = {
  type: 'object-composition';
  composition: (ObjectType | RefType)[];
};

export type MapType = {
  type: 'map';
  elementType: InnerType;
};

export type ArrayType = {
  type: 'array';
  elementType: InnerType;
};

export type EnumType = {
  type: 'enum';
  values: string[];
};

export type RefType = {
  type: 'ref';
  ref: string;
};

export type VoidType = {
  type: 'void';
};

export type InnerType =
  | StringType
  | NumberType
  | BooleanType
  | ObjectType
  | ObjectCompositionType
  | MapType
  | ArrayType
  | EnumType
  | RefType
  | VoidType;

export type Parameter = {
  place: ParameterPlace;
  name: string;
  type: InnerType;
  required: boolean;
};

export type TypeDeclaration = {
  name: string;
  fullName: string;
  type: InnerType;
};

export type ApiMethod = {
  routePath: string;
  method: string;
  params: {
    parameters: Parameter[];
    flatTypes: InnerType[];
  };
  resultType: InnerType;
};

export type TypesMap = Map<string, TypeDeclaration>;
