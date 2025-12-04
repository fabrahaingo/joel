import { Types } from "mongoose";
import Organisation from "../models/Organisation.ts";
import People from "../models/People.ts";
import User from "../models/User.ts";
import { MessageApp, IUser } from "../types.ts";
import umami from "./umami.ts";

function uniqueObjectIds(
  ids: (Types.ObjectId | undefined)[]
): Types.ObjectId[] {
  const uniqueIds = new Set<string>();
  const result: Types.ObjectId[] = [];

  ids.forEach((id) => {
    if (id == null) return;
    const idStr = id.toString();
    if (!uniqueIds.has(idStr)) {
      uniqueIds.add(idStr);
      result.push(id);
    }
  });

  return result;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function deleteEntitiesWithNoFollowers(
  peopleIds: Types.ObjectId[],
  organisationIds: string[]
): Promise<void> {
  for (const peopleId of peopleIds) {
    const isStillFollowed = await User.exists({
      "followedPeople.peopleId": peopleId
    });
    if (isStillFollowed === null) {
      await People.deleteOne({ _id: peopleId });
      await umami.log({ event: "/person-deletion-no-follow" });
    }
  }

  for (const wikidataId of organisationIds) {
    const isStillFollowed = await User.exists({
      "followedOrganisations.wikidataId": wikidataId
    });
    if (isStillFollowed === null) {
      await Organisation.deleteOne({ wikidataId });
      await umami.log({ event: "/organisation-deletion-no-follow" });
    }
  }
}

export async function deleteUserAndCleanup(user: IUser): Promise<void> {
  const peopleIds = uniqueObjectIds(
    user.followedPeople.map((followed) => followed.peopleId)
  );
  const organisationIds = uniqueStrings(
    user.followedOrganisations.map((org) => org.wikidataId)
  );

  await User.deleteOne({ _id: user._id });
  await deleteEntitiesWithNoFollowers(peopleIds, organisationIds);
}

export async function deleteUserAndCleanupByIdentifier(
  messageApp: MessageApp,
  chatId: string
): Promise<void> {
  const user = await User.findOne({ messageApp, chatId });

  if (user == null) {
    await User.deleteOne({ messageApp, chatId });
    return;
  }

  await deleteUserAndCleanup(user);
}
