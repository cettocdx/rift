/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ResendOTP from "../ResendOTP.js";
import type * as accountCreditInspection from "../accountCreditInspection.js";
import type * as admin from "../admin.js";
import type * as agentCheckpoints from "../agentCheckpoints.js";
import type * as agentDispatchAdmission from "../agentDispatchAdmission.js";
import type * as agentDispatchRequests from "../agentDispatchRequests.js";
import type * as agentDispatchStops from "../agentDispatchStops.js";
import type * as agentRunClaims from "../agentRunClaims.js";
import type * as agentRunInputs from "../agentRunInputs.js";
import type * as agentRunResources from "../agentRunResources.js";
import type * as apiKeys from "../apiKeys.js";
import type * as approvals from "../approvals.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as authCleanup from "../authCleanup.js";
import type * as botMeetings from "../botMeetings.js";
import type * as chatStreams from "../chatStreams.js";
import type * as chats from "../chats.js";
import type * as consoleWorkspaces from "../consoleWorkspaces.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as emailCanonical from "../emailCanonical.js";
import type * as extraUsage from "../extraUsage.js";
import type * as extraUsageActions from "../extraUsageActions.js";
import type * as feedback from "../feedback.js";
import type * as fileActions from "../fileActions.js";
import type * as fileAggregate from "../fileAggregate.js";
import type * as fileStorage from "../fileStorage.js";
import type * as github from "../github.js";
import type * as githubOAuthHandoffs from "../githubOAuthHandoffs.js";
import type * as hackHttpExecutions from "../hackHttpExecutions.js";
import type * as http from "../http.js";
import type * as imageStorage from "../imageStorage.js";
import type * as lib_accountCreditProductionAdmission from "../lib/accountCreditProductionAdmission.js";
import type * as lib_accountCreditReservation from "../lib/accountCreditReservation.js";
import type * as lib_accountCreditSettlement from "../lib/accountCreditSettlement.js";
import type * as lib_agentClaimCancellation from "../lib/agentClaimCancellation.js";
import type * as lib_agentDispatchAdmission from "../lib/agentDispatchAdmission.js";
import type * as lib_botTaskBindings from "../lib/botTaskBindings.js";
import type * as lib_chatCheckpointCleanup from "../lib/chatCheckpointCleanup.js";
import type * as lib_chatPersistence from "../lib/chatPersistence.js";
import type * as lib_chatSnapshot from "../lib/chatSnapshot.js";
import type * as lib_githubRepository from "../lib/githubRepository.js";
import type * as lib_hackHttpExecutions from "../lib/hackHttpExecutions.js";
import type * as lib_hackRunCleanup from "../lib/hackRunCleanup.js";
import type * as lib_logger from "../lib/logger.js";
import type * as lib_messageParts from "../lib/messageParts.js";
import type * as lib_projectBotSkills from "../lib/projectBotSkills.js";
import type * as lib_projectOwnership from "../lib/projectOwnership.js";
import type * as lib_providerReceipt from "../lib/providerReceipt.js";
import type * as lib_taskSchedule from "../lib/taskSchedule.js";
import type * as lib_utils from "../lib/utils.js";
import type * as localSandbox from "../localSandbox.js";
import type * as maintenanceRelink from "../maintenanceRelink.js";
import type * as mcpServers from "../mcpServers.js";
import type * as messages from "../messages.js";
import type * as notes from "../notes.js";
import type * as opsAlerts from "../opsAlerts.js";
import type * as otpRateLimit from "../otpRateLimit.js";
import type * as projectBots from "../projectBots.js";
import type * as projects from "../projects.js";
import type * as publishedSites from "../publishedSites.js";
import type * as rateLimitStatus from "../rateLimitStatus.js";
import type * as redisPubsub from "../redisPubsub.js";
import type * as referrals from "../referrals.js";
import type * as runs from "../runs.js";
import type * as s3Actions from "../s3Actions.js";
import type * as s3Cleanup from "../s3Cleanup.js";
import type * as s3Utils from "../s3Utils.js";
import type * as sharedChats from "../sharedChats.js";
import type * as skills from "../skills.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tasks from "../tasks.js";
import type * as teamExtraUsage from "../teamExtraUsage.js";
import type * as teamExtraUsageActions from "../teamExtraUsageActions.js";
import type * as tempStreams from "../tempStreams.js";
import type * as unitEconomics from "../unitEconomics.js";
import type * as unitEconomicsLib from "../unitEconomicsLib.js";
import type * as usageLogs from "../usageLogs.js";
import type * as userCustomization from "../userCustomization.js";
import type * as userDeletion from "../userDeletion.js";
import type * as userSuspensions from "../userSuspensions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ResendOTP: typeof ResendOTP;
  accountCreditInspection: typeof accountCreditInspection;
  admin: typeof admin;
  agentCheckpoints: typeof agentCheckpoints;
  agentDispatchAdmission: typeof agentDispatchAdmission;
  agentDispatchRequests: typeof agentDispatchRequests;
  agentDispatchStops: typeof agentDispatchStops;
  agentRunClaims: typeof agentRunClaims;
  agentRunInputs: typeof agentRunInputs;
  agentRunResources: typeof agentRunResources;
  apiKeys: typeof apiKeys;
  approvals: typeof approvals;
  artifacts: typeof artifacts;
  auth: typeof auth;
  authCleanup: typeof authCleanup;
  botMeetings: typeof botMeetings;
  chatStreams: typeof chatStreams;
  chats: typeof chats;
  consoleWorkspaces: typeof consoleWorkspaces;
  constants: typeof constants;
  crons: typeof crons;
  emailCanonical: typeof emailCanonical;
  extraUsage: typeof extraUsage;
  extraUsageActions: typeof extraUsageActions;
  feedback: typeof feedback;
  fileActions: typeof fileActions;
  fileAggregate: typeof fileAggregate;
  fileStorage: typeof fileStorage;
  github: typeof github;
  githubOAuthHandoffs: typeof githubOAuthHandoffs;
  hackHttpExecutions: typeof hackHttpExecutions;
  http: typeof http;
  imageStorage: typeof imageStorage;
  "lib/accountCreditProductionAdmission": typeof lib_accountCreditProductionAdmission;
  "lib/accountCreditReservation": typeof lib_accountCreditReservation;
  "lib/accountCreditSettlement": typeof lib_accountCreditSettlement;
  "lib/agentClaimCancellation": typeof lib_agentClaimCancellation;
  "lib/agentDispatchAdmission": typeof lib_agentDispatchAdmission;
  "lib/botTaskBindings": typeof lib_botTaskBindings;
  "lib/chatCheckpointCleanup": typeof lib_chatCheckpointCleanup;
  "lib/chatPersistence": typeof lib_chatPersistence;
  "lib/chatSnapshot": typeof lib_chatSnapshot;
  "lib/githubRepository": typeof lib_githubRepository;
  "lib/hackHttpExecutions": typeof lib_hackHttpExecutions;
  "lib/hackRunCleanup": typeof lib_hackRunCleanup;
  "lib/logger": typeof lib_logger;
  "lib/messageParts": typeof lib_messageParts;
  "lib/projectBotSkills": typeof lib_projectBotSkills;
  "lib/projectOwnership": typeof lib_projectOwnership;
  "lib/providerReceipt": typeof lib_providerReceipt;
  "lib/taskSchedule": typeof lib_taskSchedule;
  "lib/utils": typeof lib_utils;
  localSandbox: typeof localSandbox;
  maintenanceRelink: typeof maintenanceRelink;
  mcpServers: typeof mcpServers;
  messages: typeof messages;
  notes: typeof notes;
  opsAlerts: typeof opsAlerts;
  otpRateLimit: typeof otpRateLimit;
  projectBots: typeof projectBots;
  projects: typeof projects;
  publishedSites: typeof publishedSites;
  rateLimitStatus: typeof rateLimitStatus;
  redisPubsub: typeof redisPubsub;
  referrals: typeof referrals;
  runs: typeof runs;
  s3Actions: typeof s3Actions;
  s3Cleanup: typeof s3Cleanup;
  s3Utils: typeof s3Utils;
  sharedChats: typeof sharedChats;
  skills: typeof skills;
  subscriptions: typeof subscriptions;
  tasks: typeof tasks;
  teamExtraUsage: typeof teamExtraUsage;
  teamExtraUsageActions: typeof teamExtraUsageActions;
  tempStreams: typeof tempStreams;
  unitEconomics: typeof unitEconomics;
  unitEconomicsLib: typeof unitEconomicsLib;
  usageLogs: typeof usageLogs;
  userCustomization: typeof userCustomization;
  userDeletion: typeof userDeletion;
  userSuspensions: typeof userSuspensions;
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

export declare const components: {
  fileCountByUser: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"fileCountByUser">;
};
