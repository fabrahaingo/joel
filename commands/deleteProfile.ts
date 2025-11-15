import User from "../models/User.ts";
import { ISession } from "../types.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";

const DELETE_PROFILE_CONFIRMATION_PROMPT =
  "*Vous êtes sur le point de supprimer votre profil JOÉL*, comprenant l'ensemble de vos contacts, fonctions et organisations suivis.\n" +
  "⚠️ *Attention, ces données ne sont pas récupérables par la suite* ⚠️\n" +
  "Pour confirmer vous devez répondre *SUPPRIMER MON COMPTE* en majuscule à ce message";

async function askDeleteProfileQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(
    session,
    DELETE_PROFILE_CONFIRMATION_PROMPT,
    handleDeleteProfileAnswer,
    { messageOptions: { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] } }
  );
}

async function handleDeleteProfileAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      "Votre réponse n'a pas été reconnue. 👎\nSuppression annulée."
    );
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (session.user == null) {
    await session.sendMessage(
      `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${session.chatId}`
    );
    return true;
  }

  if (trimmedAnswer === "SUPPRIMER MON COMPTE") {
    await User.deleteOne({
      _id: session.user._id
    });
    session.user = null;
    await session.sendMessage(
      `🗑 Votre profil a bien été supprimé ! 👋\\splitUn profil vierge sera créé lors de l'ajout du prochain suivi ⚠️`
    );
    await session.log({ event: "/user-deletion-self" });
  } else {
    await session.sendMessage("Suppression annulée.");
  }

  return true;
}

export const deleteProfileCommand = async (
  session: ISession
): Promise<void> => {
  await session.log({ event: "/delete-profile" });
  try {
    if (session.user == null) {
      await session.sendMessage(
        `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${session.chatId}`
      );
      return;
    }

    await askDeleteProfileQuestion(session);
  } catch (error) {
    console.log(error);
  }
};
