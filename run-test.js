const { exec } = require('child_process');

console.log('Running smoke test...');
exec('node ./scripts/smoke-test.js', (error, stdout, stderr) => {
  console.log('Test completed');
  console.log('------ STDOUT ------');
  console.log(stdout);
  if (stderr) {
    console.log('------ STDERR ------');
    console.log(stderr);
  }
  if (error) {
    console.log('------ ERROR ------');
    console.log(error);
  }
});
