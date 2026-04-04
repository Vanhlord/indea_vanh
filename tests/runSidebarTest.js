import { runSmokeTest } from './runSmokeTest.js';

try {
    await runSmokeTest();
    console.log('Sidebar smoke test passed');
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
