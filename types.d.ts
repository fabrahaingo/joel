import { Model, Types } from "mongoose";
import { FunctionTags } from "./entities/FunctionTags";
import { UmamiEvent } from "./utils/umami";
import {
  ExternalMessageOptions,
  MessageSendingOptionsInternal
} from "./entities/Session.ts";

export interface CommandType {
  regex: RegExp;
  action: (session: ISession, msg: string) => Promise<void>;
}

export type MessageApp =
  | "Telegram"
  | "WhatsApp"
  | "Signal"
  | "Matrix"
  | "Tchap";

export type JORFReference = string;

export interface ISession {
  messageApp: MessageApp;
  chatId: IUser["chatId"];
  roomId?: string;
  language_code: string;
  user: IUser | null | undefined;
  isReply: boolean | undefined;

  lastEngagementAt: Date;

  loadUser: () => Promise<IUser | null>;
  createUser: () => Promise<void>;
  sendMessage: (
    msg: string,
    options?: MessageSendingOptionsInternal
  ) => Promise<boolean>;
  sendTypingAction: () => void;
  log: (args: { event: UmamiEvent; payload?: Record<string, unknown> }) => void;

  extractMessageAppsOptions: () => ExternalMessageOptions;
}

export type NotificationType =
  | "people"
  | "name"
  | "function"
  | "organisation"
  | "meta";

// fields are undefined for users created before implementation
export interface IUser {
  _id: Types.ObjectId;
  messageApp: MessageApp;
  roomId?: string;
  chatId: string;
  language_code: string;
  status: "active" | "blocked";
  waitingReengagement: boolean;
  followedPeople: {
    peopleId: Types.ObjectId;
    lastUpdate: Date;
  }[];
  followedNames: string[];
  followedOrganisations: {
    wikidataId: WikidataId;
    lastUpdate: Date;
  }[];
  followedFunctions: {
    functionTag: FunctionTags;
    lastUpdate: Date;
  }[];
  followedMeta: {
    alertString: string;
    lastUpdate: Date;
  }[];

  costHistory: {
    operationDate: Date;
    operationType: "WH_template";
    cost: number;
  }[];
  pendingNotifications: {
    notificationType: NotificationType;
    source_ids: JORFReference[];
    insertDate: Date;
    items_nb: number;
  }[];

  transferData?: {
    code: string;
    expiresAt: Date;
  };

  lastMessageReceivedAt: Date;
  lastEngagementAt: Date;

  lastInteractionDay: Date;
  lastInteractionWeek: Date;
  lastInteractionMonth: Date;

  createdAt: Date;
  updatedAt: Date;

  schemaVersion: number;

  save: () => Promise<IUser>;
  validate: () => Promise<void>;
  toObject: () => IUser;

  updateInteractionMetrics: () => Promise<void>;

  checkFollowedPeople: (arg0: IPeople | Types.ObjectId) => boolean;
  checkFollowedFunction: (arg0: FunctionTags) => boolean;
  checkFollowedName: (arg0: string) => boolean;
  checkFollowedOrganisation: (arg0: IOrganisation | WikidataId) => boolean;
  addFollowedPeople: (arg0: IPeople) => Promise<boolean>;
  addFollowedPeopleBulk: (arg0: IPeople[]) => Promise<boolean>;
  addFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  addFollowedName: (arg0: string) => Promise<boolean>;
  addFollowedAlertString: (arg0: string) => Promise<boolean>;
  addFollowedOrganisation: (
    arg0: IOrganisation | WikidataId
  ) => Promise<boolean>;
  removeFollowedPeople: (arg0: IPeople | Types.ObjectId) => Promise<boolean>;
  removeFollowedFunction: (arg0: FunctionTags) => Promise<boolean>;
  removeFollowedName: (arg0: string) => Promise<boolean>;
  removeFollowedAlertString: (arg0: string) => Promise<boolean>;
  removeFollowedOrganisation: (
    arg0: IOrganisation | WikidataId
  ) => Promise<boolean>;
  checkFollowedAlertString: (arg0: string) => boolean;
  followsNothing: () => boolean;
}

export interface IOrganisation {
  nom: string;
  wikidataId: WikidataId;
  save: () => Promise<IOrganisation>;
  validate: () => Promise<void>;
}

export interface OrganisationModel extends Model<IOrganisation> {
  findOrCreate: (args: {
    nom: string;
    wikidataId: WikidataId;
  }) => Promise<IOrganisation>;
}

export interface UserModel extends Model<IUser> {
  findOrCreate: (session: ISession) => Promise<IUser>;
  insertPendingNotifications: (
    userId: Types.ObjectId,
    messageApp: MessageApp,
    notificationType: NotificationType,
    notificationSources: Map<JORFReference, number>
  ) => Promise<void>;
}

export interface IPeople {
  _id: Types.ObjectId;
  nom: string;
  prenom: string;

  createdAt: Date;
  updatedAt: Date;

  save: () => Promise<IPeople>;
  validate: () => Promise<void>;
}

export interface PeopleModel extends Model<IPeople> {
  findOrCreate: (people: { nom: string; prenom: string }) => Promise<IPeople>;
  deleteOne: (args) => Promise<void>;
  collection: { insertOne: (arg) => Promise<void> };
}

export type SourceName =
  | "JORF"
  | "BOMI"
  | "BOCNRS"
  | "BOSanté"
  | "BODD"
  | "BOEN"
  | "BOMJ"
  | "BOESR"
  | "BOAC";

export type TypeOrdre =
  | "nomination"
  | "réintégration"
  | "cessation de fonction"
  | "affectation"
  | "délégation de signature"
  | "promotion"
  | "admission"
  | "inscription"
  | "désignation"
  | "détachement"
  | "radiation"
  | "renouvellement"
  | "reconduction"
  | "élection"
  | "admissibilité" // also exists in JORF as "admissibilite"
  | "charge"
  | "intégration"
  | "composition"
  | "habilitation"
  | "titularisation"
  | "recrutement"
  | "disponibilité"
  | "autorisation"
  | "mise à disposition"
  | "décharge"
  | "diplome"
  | "mutation"
  | "décoration"
  | "élévation"
  | "transfert"
  | "conféré"
  | "citation"
  | "démission"
  | "attribution"
  | "reprise de fonctions"
  | "bourse"
  | "fin délégation signature"
  | "prime";

export type WikidataId = string;
