import { createLocalDemo } from './dev/api.mjs';
const baseUrl = process.env.CLIENT_SITES_BASE_URL ?? 'http://127.0.0.1:8788';
const main = async () => {
  const demo = await createLocalDemo(baseUrl);
  console.log(JSON.stringify(demo, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
