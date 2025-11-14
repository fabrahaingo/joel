import { randomBytes } from "node:crypto";
import { Types } from "mongoose";

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

const EXPORT_CODE_VALIDITY_MS = 4 * 60 * 60 * 1000; // 4 hours

const IMPORTER_CODE_PROMPT =
  "Saisir le code d'import que vous avez reçu (valable 4 heures).";
const IMPORTER_CONFIRMATION_PROMPT =
  "Confirmez-vous l'import de ces suivis ? (Oui/Non).";

export const exportCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/data-export" });
  await session.sendTypingAction();

  if (session.user == null || session.user.followsNothing()) {
    await session.sendMessage(
      "Aucun compte existant n'a été trouvé. Suivez un élément avant d'exporter vos données."
    );
    return;
  }

  const code = randomBytes(6).toString("hex").toUpperCase();
  const expirationDate = new Date(Date.now() + EXPORT_CODE_VALIDITY_MS);
  session.user.transferData = { code: code, expiresAt: expirationDate };
  await session.user.save();

  await session.sendMessage(
    `Voici votre code d'export *valable 4 heures* est :\\split*${code}*\\splitUtilisez la commande *Importer* ou /import sur votre nouveau compte afin de transférer les données.`,
    { separateMenuMessage: true }
  );
};

interface ImportConfirmationContext {
  sourceUserId: Types.ObjectId;
  code: string;
}

export const importCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/data-import" });
  await session.sendTypingAction();

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
  const code = message.trim().toUpperCase();

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

  const sourceUser: IUser | null = await User.findOne({
    "transferData.code": code
  });

  if (
    sourceUser?.transferData == null ||
    new Date().getTime() > sourceUser.transferData.expiresAt.getTime()
  ) {
    await session.sendMessage(
      "Ce code n'est pas valide ou a expiré. Vérifiez-le et réessayez avec la commande *Exporter* ou /export"
    );
    if (sourceUser != null) {
      sourceUser.transferData = undefined;
      await sourceUser.save();
    }
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

  await session.sendMessage(
    `Les éléments suivants seront copiés depuis le compte source :\n\n${summary}`
  );

  await askFollowUpQuestion(
    session,
    IMPORTER_CONFIRMATION_PROMPT,
    handleImporterConfirmation,
    {
      context: { sourceUserId: sourceUser._id, code },
      messageOptions: { forceNoKeyboard: true }
    }
  );

  return true;
}

async function handleImporterConfirmation(
  session: ISession,
  message: string,
  context: ImportConfirmationContext
): Promise<boolean> {
  const normalizedAnswer = message.trim().toLowerCase();
  const positiveAnswers = new Set(["oui", "o", "yes", "y"]);
  const negativeAnswers = new Set(["non", "n", "no"]);

  if (positiveAnswers.has(normalizedAnswer)) {
    if (session.user == null) await session.createUser();
    if (session.user == null) {
      await session.sendMessage(
        "Une erreur est survenue lors de la création du compte destinataire. Merci de réessayer."
      );
      return true;
    }

    const sourceUser: IUser | null = await User.findOne({
      _id: context.sourceUserId
    });

    if (
      sourceUser?.transferData == null ||
      new Date().getTime() > sourceUser.transferData.expiresAt.getTime()
    ) {
      await session.sendMessage(
        "Le code n'est plus valide. Relancez la commande *Exporter* ou /export pour générer un nouveau code."
      );
      return true;
    }

    copyFollowData(session.user, sourceUser);
    session.user = await session.user.save();

    sourceUser.transferData = undefined;
    await sourceUser.save();

    await session.log({ event: "/data-import-confirmed" });
    await session.sendMessage(
      "Import terminé ! Vos suivis ont été copiés sur ce compte."
    );
    return true;
  }

  if (negativeAnswers.has(normalizedAnswer)) {
    await session.sendMessage("Import annulé.");
    return true;
  }

  await session.sendMessage("Réponse non reconnue. Import annulé.");
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
