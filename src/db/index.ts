import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

const expo = openDatabaseSync('iris.db', { enableChangeListener: true });

export const db = drizzle(expo, { schema });
