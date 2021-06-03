# Openapi Api Generator

## Usage:

```
$ ts-node src/run.ts --help
Options:
  -h, --help       Show help                                           [boolean]
  -v, --version    Show version number                                 [boolean]
  -o, --out        Output directory                             [default: ./out]
      --namespace  Typescript namespace for API types              [default: ""]

Examples:
  openapi-api-generator api/openapi.yaml    Process api/openapi.yaml file
  openapi-api-generator -o ./api            Collect generated api in ./api
  api/openapi.yaml'                         directory
```

### Example

```sh
$ npx openapi-api-generator --out api examples/openapi.yaml
```

Output:

```
Success (files have been generated):
  * out/types.ts
  * out/api.ts
```
