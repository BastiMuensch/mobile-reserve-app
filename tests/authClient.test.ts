import assert from 'node:assert/strict';
import test from 'node:test';
import { handleUnauthorized, resetUnauthorizedState } from '@/lib/authClient';

function installWindow(pathname: string) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  const replaces: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(events, { location: { pathname, replace: (url: string) => replaces.push(url) } }),
  });
  return {
    events,
    replaces,
    restore() {
      if (original) Object.defineProperty(globalThis, 'window', original);
      else Reflect.deleteProperty(globalThis, 'window');
    },
  };
}

test('401 invalidates root-route auth state even without a redirect', () => {
  const fakeWindow = installWindow('/');
  let invalidations = 0;
  fakeWindow.events.addEventListener('auth-invalidated', () => invalidations += 1);
  try {
    resetUnauthorizedState();
    handleUnauthorized();
    assert.equal(invalidations, 1);
    assert.deepEqual(fakeWindow.replaces, []);
  } finally {
    resetUnauthorizedState();
    fakeWindow.restore();
  }
});

test('401 invalidates before redirecting non-root routes', () => {
  const fakeWindow = installWindow('/schule/profil');
  let invalidations = 0;
  fakeWindow.events.addEventListener('auth-invalidated', () => invalidations += 1);
  try {
    resetUnauthorizedState();
    handleUnauthorized();
    assert.equal(invalidations, 1);
    assert.deepEqual(fakeWindow.replaces, ['/']);
  } finally {
    resetUnauthorizedState();
    fakeWindow.restore();
  }
});

for (const pathname of ['/register/teacher', '/reset']) {
  test(`401 preserves the public form ${pathname} but still invalidates auth`, () => {
    const fakeWindow = installWindow(pathname);
    let invalidations = 0;
    fakeWindow.events.addEventListener('auth-invalidated', () => invalidations += 1);
    try {
      resetUnauthorizedState();
      handleUnauthorized();
      handleUnauthorized();
      assert.equal(invalidations, 2);
      assert.deepEqual(fakeWindow.replaces, []);
      // Visiting a public page must not lock the later protected-page redirect.
      window.location.pathname = '/schulamt';
      handleUnauthorized();
      handleUnauthorized();
      assert.equal(invalidations, 4);
      assert.deepEqual(fakeWindow.replaces, ['/']);
    } finally {
      resetUnauthorizedState();
      fakeWindow.restore();
    }
  });
}

for (const pathname of ['/schulamt', '/lehrkraft/profil', '/reset/private', '/reset-other', '/register/teacher/private', '/register/teacher-other']) {
  test(`401 still redirects ${pathname} exactly once`, () => {
    const fakeWindow = installWindow(pathname);
    let invalidations = 0;
    fakeWindow.events.addEventListener('auth-invalidated', () => invalidations += 1);
    try {
      resetUnauthorizedState();
      handleUnauthorized();
      handleUnauthorized();
      assert.equal(invalidations, 2);
      assert.deepEqual(fakeWindow.replaces, ['/']);
    } finally {
      resetUnauthorizedState();
      fakeWindow.restore();
    }
  });
}
