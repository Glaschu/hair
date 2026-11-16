// FIRST, before anything that can load tweetnacl: the secure random source.
// Hermes has no crypto.getRandomValues, and without it generating the salon's
// keys throws — which silently broke setting up online booking on every phone.
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
