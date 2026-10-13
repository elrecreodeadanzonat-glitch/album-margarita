import { test as base } from '@playwright/test';
import { FakeFirestore } from './fakeFirestore';

/** every test gets its own in-memory Firestore; the real one is never reached from the tests */
export const test = base.extend<{ cloud: FakeFirestore }>({
  cloud: [
    async ({ page }, use) => {
      const fake = new FakeFirestore();
      await fake.install(page);
      await use(fake);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
