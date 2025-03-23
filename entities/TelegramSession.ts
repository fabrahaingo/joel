import { ISession, IUser, MessageApp } from "../types";
import TelegramBot from "node-telegram-bot-api";
import User from "../models/User";
import umami from "../utils/umami";

export const startKeyboard: TelegramBot.SendMessageOptions = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
        selective: true,
        resize_keyboard: true,
        keyboard: [
            [{ text: "🧩 Ajouter un contact" }, { text: "👨‍💼 Ajouter une fonction" }],
            [{ text: "✋ Retirer un suivi" }, { text: "🧐 Lister mes suivis" }],
            [{ text: "🔎 Rechercher" }, { text: "❓ Aide / Contact" }],
        ],
    },
};

export class TelegramSession implements ISession {
    message_app = "Telegram" as MessageApp;
    telegramBot: TelegramBot;
    language_code: string;
    chatId: number;
    user: IUser | null | undefined = undefined;

    constructor(telegramBot: TelegramBot, chatId: number, language_code: string) {
        this.telegramBot = telegramBot;
        this.chatId = chatId;
        this.language_code = language_code;
    }

    // try to fetch user from db
    async loadUser() {
        this.user = await User.findOne({ chatId: this.chatId, message_app: this.message_app });
        if (this.user != null) { // If user is known, we update the session language code
            this.language_code=this.user.language_code;
        }
    }

    // Force create a user record
    async createUser() {
        this.user = await User.findOrCreate(this);
    }

    async sendMessage(msg: string, sendKeyboard: boolean) {
        if (sendKeyboard) await this.telegramBot.sendMessage(this.chatId, msg, startKeyboard);
        await this.telegramBot.sendMessage(this.chatId, msg);
    }

    async sendTypingAction(){
        await this.telegramBot.sendChatAction(this.chatId, "typing");
    }

    async log(args: { event: string; data?: any }) {
        await umami.log(args);
    }

}