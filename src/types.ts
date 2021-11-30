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

export type UnionType = {
  type: 'union';
  fieldsObject?: ObjectType;
  union: (ObjectType | RefType)[];
  discriminator: {
    propertyName: string;
    mapping: any;
  };
  discriminatorType?: RefType;
};

export type ObjectCompositionType = {
  type: 'object-composition';
  composition: (ObjectType | UnionType | RefType)[];
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
  extractedEnumName?: string;
  values: string[];
};

export type RefType = {
  type: 'ref';
  ref: string;
};

export type VoidType = {
  type: 'void';
};

export type ConcreteInnerType =
  | StringType
  | NumberType
  | BooleanType
  | ObjectType
  | ObjectCompositionType
  | UnionType
  | MapType
  | ArrayType
  | EnumType
  | VoidType;

export type InnerType = ConcreteInnerType | RefType;

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
