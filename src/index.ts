import {generate} from './generator';
import {parseOpenapi} from './parser';

const entryFile = process.argv.slice(2).pop()!;

if (!entryFile) {
  console.error('Need to specify openapi file');
  process.exit(1);
}

async function run() {
  const {types, apiMethods} = await parseOpenapi(entryFile);

  await generate({types, apiMethods});
}

run().catch((err) => {
  console.error('Fatal Error');
  console.error(err);
  process.exit(1);
});
