import { ISession } from "../types.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";
import { logError } from "../utils/debugLogger.ts";
import User from "../models/User.ts";

const STATS_REFRESH_RATE = 60 * 60 * 1000; // 1 hour

interface StatsResult {
  organisations: number;
  people: number;
  names: number;
  texts: number;
  users: {
    total: number;
    apps: {
      Tchap: number;
      Telegram: number;
      Matrix: number;
      WhatsApp: number;
    };
  };
}

let cachedStats: StatsResult | null = null;
let cachedAt = 0;

export async function getCachedStats(): Promise<StatsResult> {
  const now = Date.now();
  if (cachedStats !== null && now - cachedAt < STATS_REFRESH_RATE) {
    return cachedStats;
  }

  const [organisations, people, users, names, texts] = await Promise.all([
    Organisation.countDocuments().exec(),
    People.countDocuments().exec(),
    User.aggregate<{ _id: string; count: number }>([
      {
        $group: {
          _id: "$messageApp",
          count: { $sum: 1 }
        }
      }
    ]),
    // Total number of followed names across all users (sum of followedNames array lengths)
    User.aggregate<{ _id: null; total: number }>([
      {
        $project: {
          n: { $size: { $ifNull: ["$followedNames", []] } }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$n" }
        }
      }
    ]),
    // Total number of followed meta across all users (sum of followedMeta array lengths)
    User.aggregate<{ _id: null; total: number }>([
      {
        $project: {
          n: { $size: { $ifNull: ["$followedMeta", []] } }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$n" }
        }
      }
    ])
  ]);

  cachedAt = now;
  const updatedStats: StatsResult = {
    organisations,
    people,
    names: names[0].total,
    texts: texts[0].total,
    users: {
      total: users.reduce((sum, { count }) => sum + (count || 0), 0),
      apps: Object.fromEntries(users.map(({ _id, count }) => [_id, count]))
    }
  } as StatsResult; // ESLInt doesn't detect the field existence;

  cachedStats = updatedStats;
  return updatedStats;
}

export const statsCommand = async (session: ISession): Promise<void> => {
  session.log({ event: "/stats" });
  session.sendTypingAction();
  await session.sendMessage(await getStatsText(session), {
    separateMenuMessage: true
  });
};

export const getStatsText = async (session: ISession): Promise<string> => {
  try {
    const stats = await getCachedStats();

    const followApps = [
      { app: "WhatsApp", count: stats.users.apps.WhatsApp },
      { app: "Telegram", count: stats.users.apps.Telegram },
      { app: "Matrix", count: stats.users.apps.Matrix },
      { app: "Tchap", count: stats.users.apps.Tchap }
    ].sort((a, b) => b.count - a.count);

    let msg = `📈 JOEL aujourd'hui c'est\n👨‍💻 ${String(stats.users.total)} utilisateurs\n`;

    for (const app of followApps)
      if (app.count > 0) msg += ` - ${String(app.count)} sur ${app.app}\n`;

    if (stats.people > 0)
      msg += `🕵️ ${String(stats.people)} personnes suivies\n`;

    if (stats.names > 0) msg += `🕵️ ${String(stats.names)} noms suivis\n`;

    if (stats.organisations > 0)
      msg += `🏛️ ${String(stats.organisations)} organisations suivies\n\n`;

    if (stats.texts > 0)
      msg += `📰 ${String(stats.texts)} expressions suivies\n`;

    msg += `JOEL sait combien vous êtes à l'utiliser mais il ne sait pas qui vous êtes... et il ne cherchera jamais à le savoir! 🛡`;

    return msg;
  } catch (error) {
    await logError(session.messageApp, "Error in /help command", error);
  }
  return "";
};
