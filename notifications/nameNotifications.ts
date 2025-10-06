import { Types } from "mongoose";
import { ExternalMessageOptions, sendMessage } from "../entities/Session.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { IUser, MessageApp } from "../types.ts";
import User from "../models/User.ts";
import People from "../models/People.ts";
import umami from "../utils/umami.ts";
import { formatSearchResult } from "../utils/formatSearchResult.ts";
import {
  cleanPeopleName,
  getJORFSearchLinkPeople
} from "../utils/JORFSearch.utils.ts";
import {
  NotificationTask,
  dispatchTasksToMessageApps
} from "../utils/notificationDispatch.ts";

const DEFAULT_GROUP_SEPARATOR = "====================\n\n";

export async function notifyNameMentionUpdates(
  updatedRecords: JORFSearchItem[],
  enabledApps: MessageApp[],
  messageAppsOptions: ExternalMessageOptions
) {
  const userFollowingNames: IUser[] = await User.find(
    {
      "followedNames.0": { $exists: true },
      status: "active",
      messageApp: { $in: enabledApps }
    },
    {
      _id: 1,
      messageApp: 1,
      chatId: 1,
      followedNames: 1,
      followedPeople: { peopleId: 1, lastUpdate: 1 },
      schemaVersion: 1
    }
  ).lean();
  if (userFollowingNames.length === 0) return;

  const nameMaps = updatedRecords.reduce(
    (acc, item: JORFSearchItem) => {
      const nomPrenom = cleanPeopleName(`${item.nom} ${item.prenom}`);
      const prenomNom = cleanPeopleName(`${item.prenom} ${item.nom}`);

      const nomPrenomList = acc.nomPrenomMap.get(nomPrenom) ?? [];
      const prenomNomList = acc.prenomNomMap.get(prenomNom) ?? [];

      nomPrenomList.push(item);
      prenomNomList.push(item);

      acc.nomPrenomMap.set(nomPrenom, nomPrenomList);
      acc.prenomNomMap.set(prenomNom, prenomNomList);

      return acc;
    },
    {
      nomPrenomMap: new Map<string, JORFSearchItem[]>(),
      prenomNomMap: new Map<string, JORFSearchItem[]>()
    }
  );

  const now = new Date();

  const userUpdateTasks: NotificationTask<string>[] = [];

  const peopleIdByFollowedNameMap = new Map<string, Types.ObjectId>();

  for (const user of userFollowingNames) {
    const newUserTagsUpdates = new Map<string, JORFSearchItem[]>();

    for (const followedName of user.followedNames) {
      const cleanFollowedName = cleanPeopleName(followedName);
      const mentions =
        nameMaps.prenomNomMap.get(cleanFollowedName) ??
        nameMaps.nomPrenomMap.get(cleanFollowedName);
      if (mentions === undefined || mentions.length === 0) continue;

      const people = await People.findOrCreate({
        nom: mentions[0].nom,
        prenom: mentions[0].prenom
      });
      peopleIdByFollowedNameMap.set(followedName, people._id);
      newUserTagsUpdates.set(followedName, mentions);
    }

    let totalUserRecordsCount = 0;
    newUserTagsUpdates.forEach((items) => {
      totalUserRecordsCount += items.length;
    });

    if (totalUserRecordsCount > 0)
      userUpdateTasks.push({
        userId: user._id,
        messageApp: user.messageApp,
        chatId: user.chatId,
        updatedRecordsMap: newUserTagsUpdates,
        recordCount: totalUserRecordsCount
      });
  }

  if (userUpdateTasks.length === 0) return;

  await dispatchTasksToMessageApps<string>(userUpdateTasks, async (task) => {
    await sendNameMentionUpdates(
      task.messageApp,
      task.chatId,
      task.updatedRecordsMap,
      messageAppsOptions
    );

    const user = userFollowingNames.find(
      (u) => u._id.toString() === task.userId.toString()
    );
    if (user === undefined) return;

    const peopleIdFollowedByUserStr = user.followedPeople.map((f) =>
      f.peopleId.toString()
    );

    const newFollowsIdUnique = [...task.updatedRecordsMap.keys()].reduce(
      (tab: Types.ObjectId[], idStr) => {
        const id = peopleIdByFollowedNameMap.get(idStr);
        if (
          id !== undefined &&
          !peopleIdFollowedByUserStr.includes(id.toString())
        )
          tab.push(id);
        return tab;
      },
      []
    );

    await User.updateOne(
      { _id: user._id },
      {
        $pull: {
          followedNames: {
            $in: [...task.updatedRecordsMap.keys()]
          }
        },
        $push: {
          followedPeople: {
            $each: newFollowsIdUnique.map((id) => ({
              peopleId: id,
              lastUpdate: now
            }))
          }
        }
      }
    );
  });
}

async function sendNameMentionUpdates(
  messageApp: MessageApp,
  chatId: IUser["chatId"],
  updatedRecordMap: Map<string, JORFSearchItem[]>,
  messageAppsOptions: ExternalMessageOptions
): Promise<boolean> {
  if (updatedRecordMap.size === 0) return true;

  const pluralHandler = updatedRecordMap.size > 1 ? "s" : "";

  const markdownLinkEnabled = messageApp !== "Telegram";

  let notification_text = `📢 Nouvelle${pluralHandler} publication${pluralHandler} parmi les noms que vous suivez manuellement:\n\n`;

  const keys = Array.from(updatedRecordMap.keys());
  const lastKey = keys[keys.length - 1];

  for (const peopleId of updatedRecordMap.keys()) {
    const nameUpdates = updatedRecordMap.get(peopleId);
    if (nameUpdates === undefined || nameUpdates.length === 0) {
      console.log("FollowedName notification update sent with no records");
      continue;
    }

    const prenomNom = nameUpdates[0].prenom + " " + nameUpdates[0].nom;

    const pluralHandlerPeople = nameUpdates.length > 1 ? "s" : "";
    notification_text += `Nouvelle${pluralHandlerPeople} publication${pluralHandlerPeople} pour ${
      markdownLinkEnabled
        ? `[${prenomNom}](${getJORFSearchLinkPeople(prenomNom)})`
        : `*${prenomNom}*`
    }\n\n`;

    notification_text += formatSearchResult(nameUpdates, markdownLinkEnabled, {
      isConfirmation: false,
      isListing: true,
      displayName: "no"
    });
    notification_text += `Vous suivez maintenant *${prenomNom}* ✅`;

    if (peopleId !== lastKey) notification_text += DEFAULT_GROUP_SEPARATOR;
  }

  const messageAppsOptionsApp = {
    ...messageAppsOptions,
    separateMenuMessage: true
  };

  const messageSent = await sendMessage(
    messageApp,
    chatId,
    notification_text,
    messageAppsOptionsApp
  );
  if (!messageSent) return false;

  await umami.log("/notification-update-name", messageApp);
  return true;
}
