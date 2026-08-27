/**
 * Active schema re-export.
 * - When POSTGRES_URL is set → Postgres (Neon / production)
 * - When POSTGRES_URL is unset → SQLite (local.db fallback)
 *
 * Types are identical across dialects. Table objects match the active driver
 * so existing `import { tasks, users, ... } from '@/lib/db/schema'` keep working.
 */
import * as pg from './schema.pg'
import * as sqlite from './schema.sqlite'

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || ''
const useSqlite = !postgresUrl || postgresUrl.trim() === ''

const active = useSqlite ? sqlite : pg

// Tables (runtime — dialect-correct)
export const users = active.users
export const tasks = active.tasks
export const connectors = active.connectors
export const accounts = active.accounts
export const keys = active.keys
export const taskMessages = active.taskMessages
export const settings = active.settings
export const userConnections = active.userConnections

// Zod schemas & types (identical across dialects — always from pg for stable TS)
export const logEntrySchema = pg.logEntrySchema
export type LogEntry = pg.LogEntry

export const insertUserSchema = pg.insertUserSchema
export const selectUserSchema = pg.selectUserSchema
export type User = pg.User
export type InsertUser = pg.InsertUser

export const insertTaskSchema = pg.insertTaskSchema
export const selectTaskSchema = pg.selectTaskSchema
export type Task = pg.Task
export type InsertTask = pg.InsertTask

export const insertConnectorSchema = pg.insertConnectorSchema
export const selectConnectorSchema = pg.selectConnectorSchema
export type Connector = pg.Connector
export type InsertConnector = pg.InsertConnector

export const insertAccountSchema = pg.insertAccountSchema
export const selectAccountSchema = pg.selectAccountSchema
export type Account = pg.Account
export type InsertAccount = pg.InsertAccount

export const insertKeySchema = pg.insertKeySchema
export const selectKeySchema = pg.selectKeySchema
export type Key = pg.Key
export type InsertKey = pg.InsertKey

export const insertTaskMessageSchema = pg.insertTaskMessageSchema
export const selectTaskMessageSchema = pg.selectTaskMessageSchema
export type TaskMessage = pg.TaskMessage
export type InsertTaskMessage = pg.InsertTaskMessage

export const insertSettingSchema = pg.insertSettingSchema
export const selectSettingSchema = pg.selectSettingSchema
export type Setting = pg.Setting
export type InsertSetting = pg.InsertSetting

export type UserConnection = pg.UserConnection
export type InsertUserConnection = pg.InsertUserConnection
