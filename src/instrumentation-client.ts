import { initializeUnsavedNavigationGuard } from './lib/unsavedNavigation';

// Next executes this synchronously before hydration and the first router write.
initializeUnsavedNavigationGuard();
