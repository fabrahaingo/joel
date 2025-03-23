import { startKeyboard } from "../utils/keyboards";
import { sendLongText } from "../utils/sendLongText";
import User from "../models/User";
import People from "../models/People";
import umami from "../utils/umami";
import TelegramBot, { ChatId } from "node-telegram-bot-api";
import { FunctionTags } from "../entities/FunctionTags";
import { IPeople, IUser } from "../types";

async function isWrongAnswer(
    chatId: ChatId,
    bot: TelegramBot,
    answer: number,
    peoples: IPeople[],
    followedFunctions: Array<string>
){
    if (
        isNaN(answer) ||
        answer > peoples.length + followedFunctions.length ||
        answer < 1
    ) {
        await bot.sendMessage(
            chatId,
            "La réponse donnée n'est pas sous forme de nombre.",
            startKeyboard
        );
        return true;
    }
    return false;
}

function getFunctionFromValue(value: FunctionTags) {
    const c = (Object.keys(FunctionTags)
        .find(key => FunctionTags[key as keyof typeof FunctionTags] === value));
    return c as undefined | keyof typeof FunctionTags;
}

function sortArrayAlphabetically(array: FunctionTags[]) {
    return array.sort((a, b) => {
        return a.localeCompare(b)
    });
}

async function unfollowFunctionAndConfirm(
    bot: TelegramBot,
    chatId: ChatId,
    user: IUser,
    functionToUnfollow: FunctionTags
) {
    await user.removeFollowedFunction(functionToUnfollow);
    await bot.sendMessage(
        chatId,
        `Vous ne suivez plus la fonction *${getFunctionFromValue(
            functionToUnfollow
        )}* 🙅‍♂️`,
        startKeyboard
    );
}

async function unfollowPeopleAndConfirm(
    bot: TelegramBot,
    chatId: ChatId,
    user: IUser,
    peopleToUnfollow: IPeople
) {
    await user.removeFollowedPeople(peopleToUnfollow);
    await bot.sendMessage(
        chatId,
        `Vous ne suivez plus le contact *${peopleToUnfollow.nom} ${peopleToUnfollow.prenom}* 🙅‍♂️`,
        startKeyboard
    );
}

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
    try {
        const chatId = msg.chat.id;

        await umami.log({ event: "/unfollow" });

        let i = 0;
        let j = 0;
        await bot.sendChatAction(chatId, "typing");
        let text = "";

        const noDataText=
            `Vous ne suivez aucun contact ni fonction pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;

        // Search for user: don't create if it doesn't exist
        const user: IUser | null = await User.findOne({ _id: chatId });

        if (user === null) {
            await bot.sendMessage(msg.chat.id, noDataText, startKeyboard);
            return;
        }

        const peopleIds = user.followedPeople.map((p) => p.peopleId);
        const peoples = await People.find({ _id: { $in: peopleIds } })
            .collation({ locale: "fr" })
            .sort({ nom: 1 });
        const followedFunctions = sortArrayAlphabetically(user.followedFunctions);

        if (peoples.length === 0 && followedFunctions.length === 0) {
            await bot.sendMessage(msg.chat.id, noDataText, startKeyboard);
            return;
        }

        if (followedFunctions.length > 0) {
            text += "Voici les fonctions que vous suivez :\n\n";
            for (i; i < followedFunctions.length; i++) {
                const functionName = getFunctionFromValue(
                    followedFunctions[i]
                );
                text += `${
                    i + 1
                }. *${functionName}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
                    followedFunctions[i]
                )})\n\n`;
            }
        }
        if (peoples.length > 0) {
            text += "Voici les personnes que vous suivez :\n\n";
            for (j; j < peoples.length; j++) {
                text += `${
                    j + 1 + i
                }. *${peoples[j].nom} ${peoples[j].prenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
                    `${peoples[j].prenom} ${peoples[j].nom}`
                )})\n\n`;
            }
        }

        await sendLongText(bot, chatId, text);

        const question = await bot.sendMessage(
            chatId,
            "Entrez le nombre correspondant au contact à supprimer",
            {
                reply_markup: {
                    force_reply: true,
                },
            }
        );

        return bot.onReplyToMessage(
            chatId,
            question.message_id,
            async (msg: TelegramBot.Message) => {
                const userAnswer = parseInt(msg.text || "");
                if (
                    await isWrongAnswer(
                        chatId,
                        bot,
                        userAnswer,
                        peoples,
                        followedFunctions
                    )
                )
                    return;
                if (
                    followedFunctions.length > 0 &&
                    userAnswer <= followedFunctions.length
                ) {
                    await unfollowFunctionAndConfirm(
                        bot,
                        chatId,
                        user,
                        followedFunctions[userAnswer - 1]
                    );
                    return;
                }
                await unfollowPeopleAndConfirm(
                    bot,
                    chatId,
                    user,
                    peoples[userAnswer - 1 - followedFunctions.length]
                );
                return;
            }
        );
    } catch (error) {
        console.log(error);
    }
};
