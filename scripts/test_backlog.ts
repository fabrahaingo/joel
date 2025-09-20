import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { IPeople, IUser } from "../types.ts";
import User from "../models/User.ts";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils.ts";
import { dateTOJORFFormat, JORFtoDate } from "../utils/date.utils.ts";
import fs from "node:fs";
import { convertToCSV } from "../utils/text.utils.ts";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined");
}

await (async () => {
  await mongoose.connect(MONGODB_URI).then(async () => {
    const mdb = mongoose.connection.db;
    if (!mdb) {
      throw new Error("MongoDB connection failed");
    }

    const allPeople = (await mdb
      .collection("peoples")
      .find({})
      .toArray()) as IPeople[];

    const allUsersFollowingPeople: IUser[] = await User.find({
      "followedPeople.0": { $exists: true }
    });

    const backlogTab: {
      peopleName: string;
      nbLateRecords: number;
      nbLateFollowers: number;
      newestJORFDate: Date;
      worstUpdateInDb: Date;
      peopleId: Types.ObjectId;
      userIds: Types.ObjectId[];
    }[] = [];

    for (const people of allPeople) {
      const usersFollowingThisGuy = allUsersFollowingPeople.filter((u) =>
        u.followedPeople.some(
          (f) => f.peopleId.toString() === people._id.toString()
        )
      );
      let worstLastUpdate = new Date();
      for (const userFollowing of usersFollowingThisGuy) {
        const follow = userFollowing.followedPeople.find(
          (f) => f.peopleId.toString() === people._id.toString()
        );
        if (follow === undefined) {
          console.log(
            people.prenom + " " + people.nom,
            userFollowing._id.toString()
          );
          throw Error("Follow not found");
        }
        if (follow.lastUpdate.getTime() < worstLastUpdate.getTime())
          worstLastUpdate = follow.lastUpdate;
      }
      const prenomNom = people.prenom + " " + people.nom;
      const nomPrenom = people.nom + " " + people.prenom;
      const peopleItems = await callJORFSearchPeople(prenomNom);
      if (peopleItems.length == 0) {
        console.log(prenomNom);
        throw Error("No people found");
      }

      const newestUpdateDate = JORFtoDate(peopleItems[0].source_date);

      const usersNotNotified: IUser[] = [];
      for (const userFollowing of usersFollowingThisGuy) {
        const follow = userFollowing.followedPeople.find(
          (f) => f.peopleId.toString() === people._id.toString()
        );
        if (follow == undefined) {
          console.log(prenomNom);
          throw Error("Follow not found");
        }
        if (follow.lastUpdate.getTime() < newestUpdateDate.getTime())
          usersNotNotified.push(userFollowing);
      }

      if (newestUpdateDate.getTime() > worstLastUpdate.getTime()) {
        const nbLateRecords = peopleItems.filter(
          (item) => JORFtoDate(item.source_date) >= worstLastUpdate
        ).length;

        backlogTab.push({
          peopleId: people._id,
          nbLateRecords: nbLateRecords,
          nbLateFollowers: usersNotNotified.length,
          peopleName: nomPrenom,
          userIds: usersNotNotified.map((u) => u._id),
          newestJORFDate: newestUpdateDate,
          worstUpdateInDb: worstLastUpdate
        });
      }
    }
    backlogTab.sort((a, b) => b.nbLateRecords - a.nbLateRecords);

    const backlog_csv = convertToCSV(
      backlogTab.map((item) => ({
        peopleName: item.peopleName,
        nbLateRecords: item.nbLateRecords,
        nbLateFollowers: item.nbLateFollowers,
        newestJORFDate: dateTOJORFFormat(item.newestJORFDate)
          .split("-")
          .reverse()
          .join("-"),
        worstUpdateInDb: dateTOJORFFormat(item.worstUpdateInDb)
          .split("-")
          .reverse()
          .join("-")
      })) as never[]
    );

    if (backlog_csv !== null) {
      fs.writeFileSync("backlog.csv", backlog_csv, "utf8");
    }
  });

  process.exit(0);
})();
