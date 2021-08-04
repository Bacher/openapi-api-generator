export type YamlRef = {
  $ref: string;
};

export type YamlType =
  | YamlRef
  | {
      type: 'string';
      enum?: string[];
    }
  | {
      type: 'integer';
    }
  | {
      type: 'number';
    }
  | {
      type: 'boolean';
    }
  | {
      type: 'array';
      items: YamlType;
    }
  | YamlObject;

export type YamlObject = {
  type?: 'object';
  title?: string;
  required?: string[];
} & (
  | {
      properties: Record<string, YamlType>;
    }
  | {
      allOf: (YamlRef | YamlObject)[];
    }
  | {
      oneOf: (YamlRef | YamlObject)[];
      discriminator: {
        propertyName: string;
        mapping: Record<string, string>;
      };
    }
  | {
      additionalProperties: YamlType;
    }
);

export type Schema = YamlRef | YamlObject;

export type YamlBody = {
  required: boolean;
  content: {
    'application/json': {
      schema: Schema;
    };
  };
};

export type YamlParameter = {
  in: 'path' | 'query' | unknown;
  name: string;
  schema: Schema;
  required: boolean;
};

export type YamlResponse = {
  '200': {
    content: {
      'application/json': {
        schema: Schema;
      };
    };
  };
};

export type YamlFile = {
  components: {
    schemas: Schema[];
  };
};

export type ApiInfo = {
  parameters?: YamlParameter[];
  requestBody?: YamlBody;
  responses?: YamlResponse;
};

export type Paths = Record<'get' | 'post', ApiInfo>;
