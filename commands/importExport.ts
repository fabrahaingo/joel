import { randomBytes } from "node:crypto";

import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import User from "../models/User.ts";
import { ISession, IUser } from "../types.ts";
import {
  buildFollowsListMessage,
  getAllUserFollowsOrdered,
  getUserFollowsTotal
} from "./list.ts";
import { cleanPeopleName } from "../utils/JORFSearch.utils.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { logError } from "../utils/debugLogger.ts";

const EXPORT_CODE_VALIDITY_MS = 4 * 60 * 60 * 1000; // 4 hours

const IMPORTER_CODE_PROMPT =
  "Saisir le code d'import que vous avez reçu (valable 4 heures).";

export const exportCommand = async (session: ISession): Promise<void> => {
  session.log({ event: "/data-export" });

  if (session.user == null || session.user.followsNothing()) {
    await session.sendMessage(
      "Aucun compte existant n'a été trouvé. Suivez un élément avant d'exporter vos données."
    );
    return;
  }

  const code = randomBytes(10).toString("hex").toUpperCase();

  const matchingUsers: IUser[] = await User.find({
    "transferData.code": code
  });
  if (matchingUsers.length > 0) {
    await logError(
      session.messageApp,
      `Un code d'export généré (${code})est entré en collision avec un autre utilisateur: ` +
        matchingUsers.map((u) => u._id.toString()).join(",")
    );
    for (const matchingUser of matchingUsers) {
      matchingUser.transferData = undefined;
      await matchingUser.save();
    }
    await session.sendMessage(
      "Une erreur est survenue lors de l'export. Veuillez réessayer la commande /export ou Export."
    );
  }

  const expirationDate = new Date(Date.now() + EXPORT_CODE_VALIDITY_MS);
  session.user.transferData = { code: code, expiresAt: expirationDate };
  await session.user.save();

  await session.sendMessage(
    `Voici votre code d'export *valable 4 heures* :\\split*${code}*\\splitUtilisez la commande _Importer_ sur votre nouveau compte afin de transférer les données.`,
    { separateMenuMessage: true }
  );
};

export const importCommand = async (session: ISession): Promise<void> => {
  session.log({ event: "/data-import" });

  await askFollowUpQuestion(session, IMPORTER_CODE_PROMPT, handleImporterCode, {
    messageOptions: {
      keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
    }
  });
};

async function handleImporterCode(
  session: ISession,
  message: string
): Promise<boolean> {
  const code = message
    .normalize("NFKC") // unify look-alike Unicode chars (e.g., fancy dashes)
    .replace(/[-_*\s]+/g, "") // drop -, _, *, and all whitespace (\s covers space, \n, \r, tabs)
    .toUpperCase();

  if (code.length === 0) {
    await session.sendMessage(
      "Le code est vide. Merci d'envoyer le code d'export que vous avez reçu."
    );
    await askFollowUpQuestion(
      session,
      IMPORTER_CODE_PROMPT,
      handleImporterCode,
      {
        messageOptions: {
          keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
        }
      }
    );
    return true;
  }

  const matchingUsers: IUser[] = await User.find({
    "transferData.code": code
  });

  if (matchingUsers.length == 0) {
    await session.sendMessage(
      "Ce code n'est pas valide. Vérifiez-le et réessayez avec la commande *Exporter* ou /export"
    );
    return true;
  }
  if (matchingUsers.length > 1) {
    await session.sendMessage(
      "Une erreur est survenue. Veuillez réessayez avec la commande *Exporter* ou /export"
    );
    await logError(
      session.messageApp,
      `Error in /importCommand command: found ${String(matchingUsers.length)} users with export code ${code}: ${matchingUsers.map((u) => u._id.toString()).join(", ")}`
    );
    for (const user of matchingUsers) {
      user.transferData = undefined;
      await user.save();
    }
    return true;
  }
  const sourceUser = matchingUsers[0];
  if (sourceUser.transferData == null) return true; // will not happen, but TS doesn't know that

  if (new Date().getTime() > sourceUser.transferData.expiresAt.getTime()) {
    await session.sendMessage(
      "Ce code a expiré. Vérifiez-le et réessayez avec la commande *Exporter* ou /export"
    );
    sourceUser.transferData = undefined;
    await sourceUser.save();
    return true;
  }

  if (
    session.user != null &&
    sourceUser._id.toString() === session.user._id.toString()
  ) {
    await session.sendMessage(
      "Ce code correspond à votre compte actuel. Générez un code depuis le compte à exporter et réessayez sur le compte destinataire."
    );
    return true;
  }

  const userFollows = await getAllUserFollowsOrdered(sourceUser);
  const followTotal = getUserFollowsTotal(userFollows);

  if (followTotal === 0) {
    await session.sendMessage(
      "Le compte source ne suit aucun élément : rien à importer."
    );
    return true;
  }

  const summary = buildFollowsListMessage(session, userFollows, {
    perspective: "thirdParty"
  });

  if (session.user == null) await session.createUser();
  if (session.user == null) {
    await session.sendMessage(
      "Une erreur est survenue lors de la création du compte destinataire. Merci de réessayer."
    );
    return true;
  }

  copyFollowData(session.user, sourceUser);
  session.user = await session.user.save();

  sourceUser.transferData = undefined;
  await sourceUser.save();

  session.log({ event: "/data-import-confirmed" });
  await session.sendMessage(
    `Les éléments suivants ont été copiés depuis le compte source :\n\n${summary}`
  );

  return true;
}

function copyFollowData(target: IUser, source: IUser): void {
  const targetPeopleIds = new Set(
    target.followedPeople.map((follow) => follow.peopleId.toString())
  );
  source.followedPeople.forEach((follow) => {
    const followId = follow.peopleId.toString();
    if (targetPeopleIds.has(followId)) return;

    target.followedPeople.push({
      peopleId: follow.peopleId,
      lastUpdate: follow.lastUpdate
    });
    targetPeopleIds.add(followId);
  });

  const targetFollowedNames = new Set(
    target.followedNames.map((name) => cleanPeopleName(name).toUpperCase())
  );
  source.followedNames.forEach((name) => {
    const normalizedName = cleanPeopleName(name).toUpperCase();
    if (targetFollowedNames.has(normalizedName)) return;

    target.followedNames.push(name);
    targetFollowedNames.add(normalizedName);
  });

  target.followedMeta = source.followedMeta;

  const targetOrgIds = new Set(
    target.followedOrganisations.map((follow) => follow.wikidataId)
  );
  source.followedOrganisations.forEach((follow) => {
    if (targetOrgIds.has(follow.wikidataId)) return;

    target.followedOrganisations.push({
      wikidataId: follow.wikidataId,
      lastUpdate: follow.lastUpdate
    });
    targetOrgIds.add(follow.wikidataId);
  });

  const targetFunctionTags = new Set(
    target.followedFunctions.map((follow) => follow.functionTag)
  );
  source.followedFunctions.forEach((follow) => {
    if (targetFunctionTags.has(follow.functionTag)) return;

    target.followedFunctions.push({
      functionTag: follow.functionTag,
      lastUpdate: follow.lastUpdate
    });
    targetFunctionTags.add(follow.functionTag);
  });
}
