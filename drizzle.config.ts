import { defineConfig } from 'drizzle-kit'

const dbFilePath = process.env.DB_FILE_PATH || process.env.DATABASE_URL || './data/app.db'

export default defineConfig({
  out: './server/db/migrations',
  schema: './server/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbFilePath,
  },
})
