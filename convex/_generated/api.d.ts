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
import type * as admin from "../admin.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as channelCategories from "../channelCategories.js";
import type * as channelMappings from "../channelMappings.js";
import type * as events from "../events.js";
import type * as feedback from "../feedback.js";
import type * as files from "../files.js";
import type * as highlightZones from "../highlightZones.js";
import type * as http from "../http.js";
import type * as mathChannels from "../mathChannels.js";
import type * as profile from "../profile.js";
import type * as scatterSuggestions from "../scatterSuggestions.js";
import type * as sharedLogs from "../sharedLogs.js";
import type * as stripe from "../stripe.js";
import type * as timeslips from "../timeslips.js";
import type * as userPreferences from "../userPreferences.js";
import type * as users from "../users.js";
import type * as vehicleChannelOverrides from "../vehicleChannelOverrides.js";
import type * as vehicles from "../vehicles.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  admin: typeof admin;
  analytics: typeof analytics;
  auth: typeof auth;
  authz: typeof authz;
  channelCategories: typeof channelCategories;
  channelMappings: typeof channelMappings;
  events: typeof events;
  feedback: typeof feedback;
  files: typeof files;
  highlightZones: typeof highlightZones;
  http: typeof http;
  mathChannels: typeof mathChannels;
  profile: typeof profile;
  scatterSuggestions: typeof scatterSuggestions;
  sharedLogs: typeof sharedLogs;
  stripe: typeof stripe;
  timeslips: typeof timeslips;
  userPreferences: typeof userPreferences;
  users: typeof users;
  vehicleChannelOverrides: typeof vehicleChannelOverrides;
  vehicles: typeof vehicles;
  workspaces: typeof workspaces;
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
