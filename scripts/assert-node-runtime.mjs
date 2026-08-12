const expectedMajor = 24;
const actualVersion = process.versions.node;
const actualMajor = Number.parseInt(actualVersion.split(".")[0] ?? "", 10);

if (actualMajor !== expectedMajor) {
  console.error(`Unsupported Node.js ${actualVersion}; expected Node.js ${expectedMajor}.x`);
  process.exit(1);
}
