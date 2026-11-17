/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as allowances from "../allowances.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as carryover from "../carryover.js";
import type * as countries from "../countries.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as departments from "../departments.js";
import type * as email from "../email.js";
import type * as format from "../format.js";
import type * as holidays from "../holidays.js";
import type * as http from "../http.js";
import type * as lateness from "../lateness.js";
import type * as leave from "../leave.js";
import type * as leaveTypes from "../leaveTypes.js";
import type * as migrations from "../migrations.js";
import type * as model from "../model.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  allowances: typeof allowances;
  audit: typeof audit;
  auth: typeof auth;
  carryover: typeof carryover;
  countries: typeof countries;
  crons: typeof crons;
  demo: typeof demo;
  departments: typeof departments;
  email: typeof email;
  format: typeof format;
  holidays: typeof holidays;
  http: typeof http;
  lateness: typeof lateness;
  leave: typeof leave;
  leaveTypes: typeof leaveTypes;
  migrations: typeof migrations;
  model: typeof model;
  notes: typeof notes;
  notifications: typeof notifications;
  reports: typeof reports;
  seed: typeof seed;
  settings: typeof settings;
  teams: typeof teams;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
