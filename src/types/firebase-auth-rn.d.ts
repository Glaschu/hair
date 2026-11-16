import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

/**
 * `getReactNativePersistence` exists at runtime — `firebase/auth` re-exports
 * `@firebase/auth`, and Metro resolves that package's React Native build,
 * which exports it. But `firebase`'s export map lists `"types"` before
 * `"react-native"`, so TypeScript takes the browser typings, which omit it.
 *
 * This declares exactly the one function, with Firebase's own signature
 * (@firebase/auth/dist/rn/src/platform_react_native/persistence/react_native.d.ts),
 * rather than casting the import to `any` and losing checking at the one call
 * that decides whether she stays signed in.
 */
declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
