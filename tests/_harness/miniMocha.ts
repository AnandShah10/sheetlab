// Minimal describe/it shim so we can smoke-test the mocha-style test files
// in this sandbox without network access to install mocha. Not shipped as
// part of the extension; real CI should use `npm run test:unit` (mocha).
let currentSuite = '';
let pass = 0;
let fail = 0;

(global as any).describe = (name: string, fn: () => void) => {
  const prev = currentSuite;
  currentSuite = prev ? `${prev} > ${name}` : name;
  fn();
  currentSuite = prev;
};

(global as any).it = (name: string, fn: () => void) => {
  try {
    fn();
    pass++;
    console.log(`  PASS ${currentSuite} :: ${name}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${currentSuite} :: ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
};

process.on('exit', () => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
});
