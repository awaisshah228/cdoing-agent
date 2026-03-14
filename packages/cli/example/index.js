console.log('Hello from example project!');
console.log('This is a test project for cdoing-agent');

// Cron-like functionality: print message every 5 seconds
console.log('Starting cron job - printing message every 5 seconds...');

setInterval(() => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Cron job executed - Hello from scheduled task!`);
}, 5000); // 5000 milliseconds = 5 seconds